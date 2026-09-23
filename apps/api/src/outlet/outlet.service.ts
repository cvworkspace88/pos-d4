import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
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

/** What `update` saves. The code is not in here: only `create` and `setCode` write it. */
export type OutletDetails = Omit<OutletInput, 'code'>;

export interface StaffOutput {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
}

/** What clients see of an outlet. Timestamps stay server-side; `deletedAt` shows only as `active`. */
export const outletOutput = (o: Outlet) => ({
  id: o.id,
  name: o.name,
  code: o.code,
  address: o.address,
  phone: o.phone,
  active: o.deletedAt === null,
});
export type OutletOutput = ReturnType<typeof outletOutput>;

/** The transaction handle drizzle hands to the `transaction` callback. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const live = isNull(outlets.deletedAt);
const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Outlet tidak ditemukan.' });

/**
 * A duplicate name and a duplicate code are the same Postgres error; only the index name tells
 * them apart. Anything else rethrows untouched — a CONFLICT we cannot explain is worse than a 500.
 */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error)) {
    const field = conflictField(violatedConstraint(error));
    if (field === 'name') throw new TRPCError({ code: 'CONFLICT', message: 'Nama outlet sudah dipakai.' });
    if (field === 'code') throw new TRPCError({ code: 'CONFLICT', message: 'Kode outlet sudah dipakai.' });
  }
  throw error;
};

/** Omitted address and phone clear the column: `update` is a full form save, not a patch. */
const detailsRow = (input: OutletDetails) => ({
  name: input.name,
  address: input.address ?? null,
  phone: input.phone ?? null,
});

const createRow = (input: OutletInput) => ({ ...detailsRow(input), code: normalizeCode(input.code) });

@Injectable()
export class OutletService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every outlet, including the deactivated ones: this list is the screen that reactivates them. */
  async list(): Promise<OutletOutput[]> {
    const rows = await this.db
      .select()
      .from(outlets)
      .orderBy(sql`${outlets.deletedAt} IS NULL DESC`, outlets.name);
    return rows.map(outletOutput);
  }

  async get(id: string): Promise<OutletOutput> {
    return outletOutput(await this.find(id));
  }

  async create(input: OutletInput): Promise<OutletOutput> {
    try {
      const [row] = await this.db.insert(outlets).values(createRow(input)).returning();
      return outletOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  async update(id: string, input: OutletDetails): Promise<OutletOutput> {
    await this.find(id);
    try {
      const [row] = await this.db
        .update(outlets)
        .set(detailsRow(input))
        .where(and(eq(outlets.id, id), live))
        .returning();
      return outletOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /**
   * The code alone. Separate from `update` because it is printed on receipts and keys terminal
   * setup, so changing it stays a deliberate act rather than a field saved with the address.
   */
  async setCode(id: string, code: string): Promise<OutletOutput> {
    await this.find(id);
    try {
      const [row] = await this.db
        .update(outlets)
        .set({ code: normalizeCode(code) })
        .where(and(eq(outlets.id, id), live))
        .returning();
      return outletOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /**
   * Takes an outlet out of service, or puts it back. `deletedAt` is the only state axis, so this
   * is the old soft delete with a way back. The lookup deliberately skips the `live` filter that
   * `find` applies — a deactivated outlet is exactly the row reactivation has to find.
   *
   * Reactivating can collide: the unique indexes are partial, so closing an outlet frees its name
   * and code for another one to take.
   */
  async setActive(id: string, active: boolean): Promise<OutletOutput> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(outlets).where(eq(outlets.id, id));
      if (!row) throw notFound();
      if ((row.deletedAt === null) === active) return outletOutput(row);

      if (!active) {
        // A system with no live outlet has nobody able to sign in anywhere, and no screen left to
        // undo it from.
        // ponytail: read-committed count, so two concurrent deactivations could both pass it.
        // Owner-only writes at single-digit volume; take an advisory lock if that ever races.
        const [liveCount] = await tx.select({ n: count() }).from(outlets).where(isNull(outlets.deletedAt));
        if ((liveCount?.n ?? 0) <= 1)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Harus ada minimal satu outlet aktif.',
          });
      }

      try {
        const [updated] = await tx
          .update(outlets)
          .set({ deletedAt: active ? null : new Date() })
          .where(eq(outlets.id, id))
          .returning();
        return outletOutput(updated!);
      } catch (error) {
        return rethrowAsConflict(error);
      }
    });
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

  /** The roles `setStaff` accepts: every role but owner, which is global and never on a roster. */
  async assignableRoles(): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(ne(roles.name, OWNER_ROLE))
      .orderBy(roles.name);
  }

  private async rosterOf(db: Database | Tx, outletId: string): Promise<StaffOutput[]> {
    return db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        roleId: outletStaff.roleId,
        roleName: roles.name,
      })
      .from(outletStaff)
      .innerJoin(users, eq(users.id, outletStaff.userId))
      .innerJoin(roles, eq(roles.id, outletStaff.roleId))
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
