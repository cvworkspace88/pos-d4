import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { and, count, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { DRIZZLE, type Database, type Tx } from '../db/db.module';
import { isUniqueViolation, violatedConstraint } from '../db/errors';
import { outletStaff, outlets, roles, users, type OrderType, type Outlet } from '../db/schema';
import { canManageRole, conflictField, normalizeCode, staffDiff, type StaffEntry } from './outlet-rules';

export interface OutletInput {
  name: string;
  code: string;
  address?: string;
  phone?: string;
}

/** Indonesia's three zones, as IANA names: WIB, WITA, WIT. */
export type Timezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

/**
 * What `update` saves. The code is not in here: only `create` and `setCode` write it. City and
 * timezone are not on `create`: a new outlet takes the defaults and is edited on the settings page.
 */
export type OutletDetails = Omit<OutletInput, 'code'> & { city?: string; timezone: Timezone };

/** What `setCharges` saves: the outlet's taxes and one service charge. Rates in basis points. */
export interface OutletCharges {
  pbjtLabel: string;
  pbjtRateBp: number;
  pbjtInclusive: boolean;
  serviceName: string;
  serviceRateBp: number;
  servicePbjtTaxable: boolean;
  /** Order types that pay the service charge. Empty = none do. */
  serviceOrderTypes: OrderType[];
  /** Omitted = cleared, like the address on `update`. */
  npwp?: string;
  npwpd?: string;
  ppnInclusive: boolean;
  ppnRateBp: number;
}

/** What `setBusinessDay` saves. Local times as `HH:mm`, in the outlet's timezone. */
export interface OutletBusinessDay {
  businessDayCutoff: string;
  /** Omitted = cleared: the day closes by hand only. */
  businessDayAutoClose?: string;
}

export interface StaffOutput {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  /** A global role (owner): on every roster, never a membership, so `setStaff` does not take it. */
  global: boolean;
}

/** What clients see of an outlet. Timestamps stay server-side; `deletedAt` shows only as `active`. */
export const outletOutput = (o: Outlet) => ({
  id: o.id,
  name: o.name,
  code: o.code,
  address: o.address,
  phone: o.phone,
  city: o.city,
  timezone: o.timezone,
  pbjtLabel: o.pbjtLabel,
  pbjtRateBp: o.pbjtRateBp,
  pbjtInclusive: o.pbjtInclusive,
  serviceName: o.serviceName,
  serviceRateBp: o.serviceRateBp,
  servicePbjtTaxable: o.servicePbjtTaxable,
  serviceOrderTypes: o.serviceOrderTypes,
  npwp: o.npwp,
  npwpd: o.npwpd,
  ppnInclusive: o.ppnInclusive,
  ppnRateBp: o.ppnRateBp,
  // Postgres hands `time` back as HH:mm:ss; clients read and write HH:mm.
  businessDayCutoff: o.businessDayCutoff.slice(0, 5),
  businessDayAutoClose: o.businessDayAutoClose?.slice(0, 5) ?? null,
  active: o.deletedAt === null,
});
export type OutletOutput = ReturnType<typeof outletOutput>;

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

/** Omitted address, phone and city clear the column: `update` is a full form save, not a patch. */
const detailsRow = (input: OutletDetails) => ({
  name: input.name,
  address: input.address ?? null,
  phone: input.phone ?? null,
  city: input.city ?? null,
  timezone: input.timezone,
});

export interface NewStaffInput {
  name: string;
  username: string;
  password: string;
  /** Optional: only staff who sign in on a shared tablet need one. */
  pin?: string;
  roleId: string;
}

const createRow = (input: OutletInput) => ({
  name: input.name,
  address: input.address ?? null,
  phone: input.phone ?? null,
  code: normalizeCode(input.code),
});

/** A roster as the audit log stores it: username → role, so the diff names who moved, not ids. */
const rosterSnapshot = (roster: StaffOutput[]) =>
  Object.fromEntries(roster.map((s) => [s.username, s.roleName]));

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

  async create(input: OutletInput, actor: Actor): Promise<OutletOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(outlets).values(createRow(input)).returning();
        await audit(tx, actor, {
          outletId: row!.id,
          module: 'outlet',
          action: 'outlet.create',
          entityType: 'outlet',
          entityId: row!.id,
          after: row,
        });
        return outletOutput(row!);
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  async update(id: string, input: OutletDetails, actor: Actor): Promise<OutletOutput> {
    return this.change(id, 'outlet.update', detailsRow(input), actor);
  }

  /**
   * The code alone. Separate from `update` because it is printed on receipts and keys terminal
   * setup, so changing it stays a deliberate act rather than a field saved with the address.
   */
  async setCode(id: string, code: string, actor: Actor): Promise<OutletOutput> {
    return this.change(id, 'outlet.set_code', { code: normalizeCode(code) }, actor);
  }

  /** The tax and service charge, saved as one form. Last save wins: this is configuration, not a bill. */
  async setCharges(id: string, charges: OutletCharges, actor: Actor): Promise<OutletOutput> {
    // `||`, not `??`: the router trims, so a blank-but-spaced NPWPD arrives as '' and must clear too.
    const set = {
      ...charges,
      npwp: charges.npwp ?? null,
      npwpd: charges.npwpd || null,
      serviceOrderTypes: [...new Set(charges.serviceOrderTypes)],
    };
    return this.change(id, 'outlet.set_charges', set, actor);
  }

  async setBusinessDay(id: string, day: OutletBusinessDay, actor: Actor): Promise<OutletOutput> {
    const set = {
      businessDayCutoff: day.businessDayCutoff,
      businessDayAutoClose: day.businessDayAutoClose ?? null,
    };
    return this.change(id, 'outlet.set_business_day', set, actor);
  }

  /**
   * One audited write to a live outlet: lock the row, update it, record the change, all in one
   * transaction. Last save wins: this is configuration, not a bill.
   */
  private async change(
    id: string,
    action: `outlet.${string}`,
    set: Partial<typeof outlets.$inferInsert>,
    actor: Actor,
  ): Promise<OutletOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(outlets)
          .where(and(eq(outlets.id, id), live))
          .for('update');
        if (!before) throw notFound();
        const [after] = await tx.update(outlets).set(set).where(eq(outlets.id, id)).returning();
        await audit(tx, actor, {
          outletId: id,
          module: 'outlet',
          action,
          entityType: 'outlet',
          entityId: id,
          before,
          after,
        });
        return outletOutput(after!);
      });
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
  async setActive(id: string, active: boolean, actor: Actor): Promise<OutletOutput> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(outlets).where(eq(outlets.id, id)).for('update');
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
        await audit(tx, actor, {
          outletId: id,
          module: 'outlet',
          action: 'outlet.set_active',
          entityType: 'outlet',
          entityId: id,
          before: row,
          after: updated,
        });
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
  async setStaff(outletId: string, staff: StaffEntry[], actor: Actor): Promise<StaffOutput[]> {
    return this.db.transaction(async (tx) => {
      const [outlet] = await tx
        .select({ id: outlets.id })
        .from(outlets)
        .where(and(eq(outlets.id, outletId), live));
      if (!outlet) throw notFound();

      const userIds = [...new Set(staff.map((s) => s.userId))];
      if (userIds.length) {
        const found = await tx
          .select({ id: users.id, global: isNotNull(users.roleId) })
          .from(users)
          .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
        const alive = new Set(found.map((u) => u.id));
        const missing = userIds.find((id) => !alive.has(id));
        // Reject the whole call rather than silently assigning the ids that happened to be real.
        if (missing) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid user: ${missing}.` });
        // A global-role user works everywhere already; a membership row for them is only a stray
        // that the page never sends back, so the next save would read it as a removal.
        if (found.some((u) => u.global))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });
      }

      const roleIds = [...new Set(staff.map((s) => s.roleId))];
      const known = new Map<string, { name: string; editable: boolean }>();
      if (roleIds.length) {
        const found = await tx
          .select({ id: roles.id, name: roles.name, editable: roles.editable, isGlobal: roles.isGlobal })
          .from(roles)
          .where(inArray(roles.id, roleIds));
        for (const r of found) known.set(r.id, r);
        const missing = roleIds.find((id) => !known.has(id));
        if (missing) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid role: ${missing}.` });
        // The global role is `users.role_id`, never a membership: handing it out here would be an escalation.
        if (found.some((r) => r.isGlobal))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });
      }

      const current = await tx
        .select({
          userId: outletStaff.userId,
          roleId: outletStaff.roleId,
          roleName: roles.name,
          roleEditable: roles.editable,
        })
        .from(outletStaff)
        .innerJoin(roles, eq(roles.id, outletStaff.roleId))
        .where(eq(outletStaff.outletId, outletId));
      const { add, remove } = staffDiff(current, staff);

      // Only lines that change are judged: a manager resending a roster that still lists another
      // manager, untouched, is fine. A role change is a remove plus an add, so both roles count.
      const held = new Map(current.map((c) => [c.userId, { name: c.roleName, editable: c.roleEditable }]));
      const touched = [...add.map((a) => known.get(a.roleId)!), ...remove.map((id) => held.get(id)!)];
      if (touched.some((role) => !canManageRole(actor.global, role)))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Hanya owner yang bisa mengatur peran ini.' });

      const before = await this.rosterOf(tx, outletId);
      if (remove.length)
        await tx
          .delete(outletStaff)
          .where(and(eq(outletStaff.outletId, outletId), inArray(outletStaff.userId, remove)));
      if (add.length) await tx.insert(outletStaff).values(add.map((s) => ({ outletId, ...s })));

      const after = await this.rosterOf(tx, outletId);
      await audit(tx, actor, {
        outletId,
        module: 'staff',
        action: 'staff.set_roster',
        entityType: 'outlet',
        entityId: outletId,
        before: rosterSnapshot(before),
        after: rosterSnapshot(after),
      });
      return after;
    });
  }

  /**
   * A new account and its membership here, in one transaction: a user with no outlet would be an
   * account nobody can see on any roster. Same role rules as `setStaff`. Not idempotent — a retry
   * after a lost response answers CONFLICT on the username, and the refetched roster shows the row.
   */
  async addStaff(outletId: string, input: NewStaffInput, actor: Actor): Promise<StaffOutput[]> {
    // Hashed before the transaction: argon2 is deliberately slow, and a row lock should not wait on it.
    const [passwordHash, pinHash] = await Promise.all([
      argon2.hash(input.password),
      input.pin ? argon2.hash(input.pin) : null,
    ]);

    return this.db.transaction(async (tx) => {
      const [outlet] = await tx
        .select({ id: outlets.id })
        .from(outlets)
        .where(and(eq(outlets.id, outletId), live));
      if (!outlet) throw notFound();

      const [role] = await tx
        .select({ name: roles.name, editable: roles.editable, isGlobal: roles.isGlobal })
        .from(roles)
        .where(eq(roles.id, input.roleId));
      if (!role) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid role: ${input.roleId}.` });
      if (role.isGlobal) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });
      if (!canManageRole(actor.global, role))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Hanya owner yang bisa mengatur peran ini.' });

      // The unique index is the check, not a lookup first: two admins adding the same username at
      // once must not both pass. A soft-deleted user still holds their username.
      const user = await tx
        .insert(users)
        .values({ name: input.name, username: input.username.toLowerCase(), passwordHash, pinHash })
        .returning({ id: users.id })
        .then(([row]) => row!)
        .catch((error: unknown) => {
          if (isUniqueViolation(error))
            throw new TRPCError({ code: 'CONFLICT', message: 'Username sudah dipakai.' });
          throw error;
        });
      await tx.insert(outletStaff).values({ outletId, userId: user.id, roleId: input.roleId });
      await audit(tx, actor, {
        outletId,
        module: 'staff',
        action: 'staff.add',
        entityType: 'user',
        entityId: user.id,
        // The PIN is masked by `auditDiff`: the row shows one was set, never what it is.
        after: {
          name: input.name,
          username: input.username.toLowerCase(),
          role: role.name,
          pin: input.pin ?? null,
        },
      });

      return this.rosterOf(tx, outletId);
    });
  }

  /**
   * Existing accounts that could join this roster: live, not global (owner works everywhere
   * already), not on it yet. Username prefix only — the one key staff are told to search by.
   */
  async findUsers(
    outletId: string,
    username: string,
  ): Promise<{ id: string; name: string; username: string }[]> {
    await this.find(outletId);
    // Usernames are stored lowercase, so a plain LIKE is case-insensitive. Escape the wildcards so
    // `_` in a search is a literal underscore.
    const prefix = `${username.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    return this.db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), eq(outletStaff.outletId, outletId)))
      .where(
        and(
          like(users.username, prefix),
          isNull(users.deletedAt),
          isNull(users.roleId),
          isNull(outletStaff.userId),
        ),
      )
      .orderBy(users.username)
      .limit(10);
  }

  /** The roles `setStaff` lets this actor hand out: never the global one; manager and custom roles only for a global actor. */
  async assignableRoles(actor: { global: boolean }): Promise<{ id: string; name: string }[]> {
    const rows = await this.db
      .select({ id: roles.id, name: roles.name, editable: roles.editable })
      .from(roles)
      .where(eq(roles.isGlobal, false))
      .orderBy(roles.name);
    return rows.filter((r) => canManageRole(actor.global, r)).map(({ id, name }) => ({ id, name }));
  }

  /**
   * Members of the outlet plus every global-role user (owner), who works everywhere without a row.
   * A global role wins over any stray membership, the same way `permissionsOf` resolves it.
   */
  private async rosterOf(db: Database | Tx, outletId: string): Promise<StaffOutput[]> {
    const roleId = sql<string>`coalesce(${users.roleId}, ${outletStaff.roleId})`;
    return db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        roleId,
        roleName: roles.name,
        global: sql<boolean>`${users.roleId} is not null`,
      })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), eq(outletStaff.outletId, outletId)))
      .innerJoin(roles, eq(roles.id, roleId))
      .where(and(isNull(users.deletedAt), or(isNotNull(users.roleId), eq(outletStaff.outletId, outletId))))
      .orderBy(sql`${users.roleId} is null`, users.name);
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
