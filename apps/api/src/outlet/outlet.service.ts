import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { isUniqueViolation, violatedConstraint } from '../db/errors';
import { outletStaff, outlets, roles, users, type Outlet } from '../db/schema';
import { OWNER_ROLE, conflictField, normalizeCode, staffDiff, type StaffEntry } from './outlet-rules';

export interface OutletInput {
  name: string;
  code: string;
  address?: string;
  phone?: string;
}

export interface StaffOutput {
  id: string;
  name: string;
  username: string;
  roleId: string;
}

/** What clients see of an outlet. Timestamps and `deletedAt` stay server-side. */
export const outletOutput = (o: Outlet) => ({
  id: o.id,
  name: o.name,
  code: o.code,
  address: o.address,
  phone: o.phone,
});
export type OutletOutput = ReturnType<typeof outletOutput>;

/** The transaction handle drizzle hands to the `transaction` callback. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const live = isNull(outlets.deletedAt);
const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Outlet not found.' });

/**
 * A duplicate name and a duplicate code are the same Postgres error; only the index name tells
 * them apart. Anything else rethrows untouched — a CONFLICT we cannot explain is worse than a 500.
 */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error)) {
    const field = conflictField(violatedConstraint(error));
    if (field === 'name') throw new TRPCError({ code: 'CONFLICT', message: 'Outlet name already in use.' });
    if (field === 'code') throw new TRPCError({ code: 'CONFLICT', message: 'Outlet code already in use.' });
  }
  throw error;
};

/** Omitted address and phone clear the column: `update` is a full form save, not a patch. */
const toRow = (input: OutletInput) => ({
  name: input.name,
  code: normalizeCode(input.code),
  address: input.address ?? null,
  phone: input.phone ?? null,
});

@Injectable()
export class OutletService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(): Promise<OutletOutput[]> {
    const rows = await this.db.select().from(outlets).where(live).orderBy(outlets.name);
    return rows.map(outletOutput);
  }

  async create(input: OutletInput): Promise<OutletOutput> {
    try {
      const [row] = await this.db.insert(outlets).values(toRow(input)).returning();
      return outletOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  async update(id: string, input: OutletInput): Promise<OutletOutput> {
    await this.find(id);
    try {
      const [row] = await this.db
        .update(outlets)
        .set(toRow(input))
        .where(and(eq(outlets.id, id), live))
        .returning();
      return outletOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /**
   * Soft delete. Nothing references outlets yet, so there is no precondition to check, and the
   * `outlet_staff` rows stay behind — clearing `deletedAt` in a data fix restores the roster.
   */
  async remove(id: string): Promise<{ success: boolean }> {
    await this.find(id);
    await this.db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, id));
    return { success: true };
  }

  async staff(outletId: string): Promise<StaffOutput[]> {
    await this.find(outletId);
    return this.rosterOf(this.db, outletId);
  }

  /**
   * Replaces the whole roster, roles included. Set semantics keyed on the user, so calling it twice
   * with the same entries is a no-op the second time and the caller never has to diff anything.
   */
  async setStaff(outletId: string, staff: StaffEntry[]): Promise<StaffOutput[]> {
    return this.db.transaction(async (tx) => {
      const [outlet] = await tx
        .select({ id: outlets.id })
        .from(outlets)
        .where(and(eq(outlets.id, outletId), live));
      if (!outlet) throw notFound();

      const userIds = [...new Set(staff.map((s) => s.userId))];
      if (userIds.length) {
        const found = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
        const alive = new Set(found.map((u) => u.id));
        const missing = userIds.find((id) => !alive.has(id));
        // Reject the whole call rather than silently assigning the ids that happened to be real.
        if (missing) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid user: ${missing}.` });
      }

      const roleIds = [...new Set(staff.map((s) => s.roleId))];
      if (roleIds.length) {
        const found = await tx
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(inArray(roles.id, roleIds));
        const known = new Map(found.map((r) => [r.id, r.name]));
        const missing = roleIds.find((id) => !known.has(id));
        if (missing) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid role: ${missing}.` });
        // Owner is `users.role_id`, never a membership: handing it out here would be an escalation.
        if ([...known.values()].includes(OWNER_ROLE))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });
      }

      const current = await tx
        .select({ userId: outletStaff.userId, roleId: outletStaff.roleId })
        .from(outletStaff)
        .where(eq(outletStaff.outletId, outletId));
      const { add, remove } = staffDiff(current, staff);

      if (remove.length)
        await tx
          .delete(outletStaff)
          .where(and(eq(outletStaff.outletId, outletId), inArray(outletStaff.userId, remove)));
      if (add.length) await tx.insert(outletStaff).values(add.map((s) => ({ outletId, ...s })));

      return this.rosterOf(tx, outletId);
    });
  }

  private async rosterOf(db: Database | Tx, outletId: string): Promise<StaffOutput[]> {
    return db
      .select({ id: users.id, name: users.name, username: users.username, roleId: outletStaff.roleId })
      .from(outletStaff)
      .innerJoin(users, eq(users.id, outletStaff.userId))
      .where(and(eq(outletStaff.outletId, outletId), isNull(users.deletedAt)))
      .orderBy(users.name);
  }

  private async find(id: string): Promise<Outlet> {
    const [row] = await this.db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, id), live));
    if (!row) throw notFound();
    return row;
  }
}
