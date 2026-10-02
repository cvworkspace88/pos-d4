import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { auditApproval } from '../audit/audit';
import type { Actor, Approved } from '../auth/rbac-rules';
import { DRIZZLE, type Database } from '../db/db.module';
import { reservations, tables, type Reservation } from '../db/schema';
import { createOnce, recordSyncEvent } from '../sync/sync-event';

export type ReservationStatus = Reservation['status'];

export interface ReservationInput {
  tableId: string;
  customerName: string;
  phone?: string;
  partySize: number;
  /** ISO datetime with offset; stored as timestamptz. */
  startsAt: string;
  note?: string;
}

export type ReservationPatch = Partial<ReservationInput> & { status?: Exclude<ReservationStatus, 'booked'> };

export const reservationOutput = (r: Reservation) => ({
  id: r.id,
  tableId: r.tableId,
  customerName: r.customerName,
  phone: r.phone,
  partySize: r.partySize,
  startsAt: r.startsAt.toISOString(),
  note: r.note,
  status: r.status,
});
export type ReservationOutput = ReturnType<typeof reservationOutput>;

const closed = () => new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Reservation is closed.' });

@Injectable()
export class ReservationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(outletId: string, from: string, to: string): Promise<ReservationOutput[]> {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.outletId, outletId),
          gte(reservations.startsAt, new Date(from)),
          lt(reservations.startsAt, new Date(to)),
        ),
      )
      .orderBy(asc(reservations.startsAt));
    return rows.map(reservationOutput);
  }

  /** `id` is the client's (US-012): a retry with the same id returns the stored reservation. */
  async create(
    actor: Actor,
    outletId: string,
    input: ReservationInput & { id: string },
    approved: Approved | null = null,
  ): Promise<ReservationOutput> {
    await this.requireLiveTable(outletId, input.tableId);
    return this.db.transaction(async (tx) => {
      const { row, created } = await createOnce(
        tx,
        actor,
        reservations,
        { ...input, outletId, startsAt: new Date(input.startsAt), createdBy: actor.user.id },
        { outletId, type: 'reservation.upserted' },
      );
      if (created && approved) await auditApproval(tx, approved, 'reservation', row.id);
      return reservationOutput(row);
    });
  }

  /** Only a booked reservation changes. Seated, cancelled and no-show are terminal. */
  async update(
    actor: Actor,
    outletId: string,
    id: string,
    patch: ReservationPatch,
    approved: Approved | null = null,
  ): Promise<ReservationOutput> {
    const mine = and(eq(reservations.id, id), eq(reservations.outletId, outletId));
    const [current] = await this.db.select().from(reservations).where(mine);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reservation not found.' });
    if (current.status !== 'booked') throw closed();
    if (patch.tableId) await this.requireLiveTable(outletId, patch.tableId);

    // drizzle rejects an UPDATE with nothing to set; an empty patch is a no-op read.
    const { startsAt, ...rest } = patch;
    const set = { ...rest, ...(startsAt ? { startsAt: new Date(startsAt) } : {}) };
    if (Object.values(set).every((v) => v === undefined)) return reservationOutput(current);

    return this.db.transaction(async (tx) => {
      // Guarded on `booked` too: another tablet may have seated or cancelled it since the read above.
      const [row] = await tx
        .update(reservations)
        .set(set)
        .where(and(mine, eq(reservations.status, 'booked')))
        .returning();
      if (!row) throw closed();
      await recordSyncEvent(tx, actor, {
        outletId,
        type: 'reservation.upserted',
        entityId: id,
        payload: row,
      });
      if (approved) await auditApproval(tx, approved, 'reservation', id);
      return reservationOutput(row);
    });
  }

  private async requireLiveTable(outletId: string, tableId: string): Promise<void> {
    const [table] = await this.db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.id, tableId), eq(tables.outletId, outletId), isNull(tables.deletedAt)));
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });
  }
}
