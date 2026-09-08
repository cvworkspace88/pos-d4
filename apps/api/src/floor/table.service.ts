import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { reservations, tables, type Table } from '../db/schema';
import { rejectDelete, rejectMerge } from './floor-rules';

export interface TableInput {
  name: string;
  seats: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What clients see of a table. Timestamps and `deletedAt` stay server-side. */
export const tableOutput = (t: Table) => ({
  id: t.id,
  name: t.name,
  seats: t.seats,
  x: t.x,
  y: t.y,
  w: t.w,
  h: t.h,
  mergedIntoId: t.mergedIntoId,
});
export type TableOutput = ReturnType<typeof tableOutput>;

const live = isNull(tables.deletedAt);

// Mirrors FLOOR.size from @repo/api-contract. That package's internal imports are extensionless
// (fine for the bundler-based desktop/mobile clients), which breaks Node's runtime module
// resolution when required directly from this service — so the bound is duplicated here rather
// than imported.
const CANVAS_SIZE = 1000;

/**
 * The router bounds x/y and w/h independently, so a table can still be requested off the
 * 1000x1000 canvas (e.g. resizing in place near an edge). Slide it back in so x + w <= CANVAS_SIZE
 * and y + h <= CANVAS_SIZE always hold; w/h are already clamped to 40-500 by the router.
 */
function clampToCanvas<T extends { x: number; y: number; w: number; h: number }>(item: T): T {
  return { ...item, x: Math.min(item.x, CANVAS_SIZE - item.w), y: Math.min(item.y, CANVAS_SIZE - item.h) };
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });

/** Postgres unique violation. drizzle ≥ 0.44 wraps driver errors, so look at `cause` too. */
const isUniqueViolation = (error: unknown): boolean => {
  const direct = (error as { code?: string }).code;
  const nested = (error as { cause?: { code?: string } }).cause?.code;
  return direct === '23505' || nested === '23505';
};

@Injectable()
export class TableService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(): Promise<TableOutput[]> {
    const rows = await this.db.select().from(tables).where(live).orderBy(tables.name);
    return rows.map(tableOutput);
  }

  async create(input: TableInput): Promise<TableOutput> {
    try {
      const [row] = await this.db.insert(tables).values(clampToCanvas(input)).returning();
      return tableOutput(row!);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use.' });
      throw error;
    }
  }

  async update(id: string, patch: Pick<TableInput, 'name' | 'seats'>): Promise<TableOutput> {
    await this.find(id);
    try {
      const [row] = await this.db
        .update(tables)
        .set(patch)
        .where(and(eq(tables.id, id), live))
        .returning();
      return tableOutput(row!);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use.' });
      throw error;
    }
  }

  /** One transaction: a stale id anywhere in the batch rolls back every move. */
  async updateLayout(items: LayoutItem[]): Promise<TableOutput[]> {
    return this.db.transaction(async (tx) => {
      const out: TableOutput[] = [];
      for (const { id, ...position } of items) {
        const [row] = await tx
          .update(tables)
          .set(clampToCanvas(position))
          .where(and(eq(tables.id, id), live))
          .returning();
        if (!row) throw notFound();
        out.push(tableOutput(row));
      }
      return out;
    });
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const table = await this.find(id);
    const all = await this.db
      .select({ id: tables.id, mergedIntoId: tables.mergedIntoId })
      .from(tables)
      .where(live);
    const onTable = await this.db
      .select({ tableId: reservations.tableId, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.tableId, id));
    const reason = rejectDelete(table, all, onTable);
    if (reason) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: reason });

    await this.db.update(tables).set({ deletedAt: new Date() }).where(eq(tables.id, id));
    return { success: true };
  }

  async merge(headId: string, memberIds: string[]): Promise<TableOutput[]> {
    if (memberIds.includes(headId))
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A table cannot merge into itself.' });

    return this.db.transaction(async (tx) => {
      // Lock the live rows so a concurrent merge can't read the same pre-merge snapshot and
      // pass rejectMerge too, which would build a two-level chain (B -> A -> C).
      const all = await tx.select().from(tables).where(live).for('update');
      const byId = new Map(all.map((t) => [t.id, t]));
      const head = byId.get(headId);
      const members = memberIds.map((id) => byId.get(id));
      if (!head || members.some((m) => m === undefined)) throw notFound();

      const reason = rejectMerge(head, members as Table[], all);
      if (reason) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: reason });

      await tx.update(tables).set({ mergedIntoId: headId }).where(inArray(tables.id, memberIds));
      const rows = await tx.select().from(tables).where(live).orderBy(tables.name);
      return rows.map(tableOutput);
    });
  }

  /** On a head the whole group dissolves; on a member only that row leaves; standalone is a no-op. */
  async unmerge(id: string): Promise<TableOutput[]> {
    const table = await this.find(id);
    const target = table.mergedIntoId ? eq(tables.id, id) : eq(tables.mergedIntoId, id);
    await this.db.update(tables).set({ mergedIntoId: null }).where(target);
    return this.list();
  }

  private async find(id: string): Promise<Table> {
    const [row] = await this.db
      .select()
      .from(tables)
      .where(and(eq(tables.id, id), live));
    if (!row) throw notFound();
    return row;
  }
}
