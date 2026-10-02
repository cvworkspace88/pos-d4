import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { RbacService } from '../auth/rbac.service';
import { DRIZZLE, type Database, type Tx } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import {
  outletStaff,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userPermissions,
  users,
} from '../db/schema';
import { overrideRows, permissionMatrix, type MatrixGroup, type OverrideRow } from './role-rules';

export interface RoleMatrix {
  roles: {
    id: string;
    name: string;
    description: string | null;
    isGlobal: boolean;
    editable: boolean;
    permissionCount: number;
  }[];
  groups: MatrixGroup[];
}

/** What a custom role form saves: the full field set, grants included (a full replace). */
export interface RoleInput {
  name: string;
  description: string | null;
  permissions: string[];
}

/** One permission for one person, at each of `outletIds`. `effect: null` clears the override. */
export interface OverrideInput {
  userId: string;
  outletIds: string[];
  permission: string;
  effect: 'grant' | 'revoke' | null;
}

const staffNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Staf tidak ditemukan.' });

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Peran tidak ditemukan.' });

/** `roles.name` is the table's only unique index, so any unique violation is a duplicate name. */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error))
    throw new TRPCError({ code: 'CONFLICT', message: 'Nama peran sudah dipakai.' });
  throw error;
};

/** The audit snapshot. Grants sorted, so an unchanged save diffs to nothing. */
const snapshot = (role: { name: string; description: string | null }, granted: string[]) => ({
  name: role.name,
  description: role.description,
  permissions: [...new Set(granted)].sort(),
});

/** Roles are deployment-wide: their audit rows carry no outlet and show to global roles only. */
const entry = (entityId: string) =>
  ({ outletId: null, module: 'role', entityType: 'role', entityId }) as const;

@Injectable()
export class RoleService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Every role's grants, as the roles page draws them. Role grants only — per-user overrides are not here. */
  async matrix(): Promise<RoleMatrix> {
    const [roleRows, permissionRows, grants] = await Promise.all([
      this.db
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isGlobal: roles.isGlobal,
          editable: roles.editable,
        })
        .from(roles),
      this.db.select({ name: permissions.name, description: permissions.description }).from(permissions),
      this.db
        .select({ roleId: rolePermissions.roleId, permission: permissions.name })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
    ]);

    const held = new Map(roleRows.map((r) => [r.id, new Set<string>()]));
    for (const g of grants) held.get(g.roleId)?.add(g.permission);

    // Most permissions first, so owner leads and the read-only roles trail.
    const ordered = roleRows
      .map((r) => ({ ...r, permissionCount: held.get(r.id)!.size }))
      .sort((a, b) => b.permissionCount - a.permissionCount || a.name.localeCompare(b.name));

    return {
      roles: ordered,
      groups: permissionMatrix(
        permissionRows,
        ordered.map((r) => held.get(r.id)!),
      ),
    };
  }

  /** A custom role, usually a copy of a base role's grants. */
  async create(input: RoleInput, actor: Actor): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const permissionIds = await this.permissionIds(tx, input.permissions);
      const role = await tx
        .insert(roles)
        .values({ name: input.name, description: input.description })
        .returning()
        .then(([row]) => row!)
        .catch(rethrowAsConflict);
      await this.grant(tx, role.id, permissionIds);
      await audit(tx, actor, {
        ...entry(role.id),
        action: 'role.create',
        after: snapshot(role, input.permissions),
      });
      return { id: role.id };
    });
  }

  /** Full replace of name, description and grants. Base roles are the seed's: refused. */
  async update(id: string, input: RoleInput, actor: Actor): Promise<{ success: boolean }> {
    return this.db.transaction(async (tx) => {
      const before = await this.editableRole(tx, id);
      const permissionIds = await this.permissionIds(tx, input.permissions);
      await tx
        .update(roles)
        .set({ name: input.name, description: input.description })
        .where(eq(roles.id, id))
        .catch(rethrowAsConflict);
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await this.grant(tx, id, permissionIds);
      await audit(tx, actor, {
        ...entry(id),
        action: 'role.update',
        before,
        after: snapshot(input, input.permissions),
      });
      return { success: true };
    });
  }

  /** Hard delete: a role is config, and its audit row keeps the last state. Refused while anyone holds it. */
  async delete(id: string, actor: Actor): Promise<{ success: boolean }> {
    return this.db.transaction(async (tx) => {
      const before = await this.editableRole(tx, id);
      // `outlet_staff.role_id` is ON DELETE RESTRICT too; this check is what turns it into a message.
      const [assigned] = await tx
        .select({ userId: outletStaff.userId })
        .from(outletStaff)
        .where(eq(outletStaff.roleId, id))
        .limit(1);
      // `users.role_id` is ON DELETE SET NULL, so without this a global holder would be silently stripped.
      const [heldGlobally] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.roleId, id))
        .limit(1);
      if (assigned || heldGlobally)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Peran masih dipakai staf.' });
      await tx.delete(roles).where(eq(roles.id, id));
      await audit(tx, actor, { ...entry(id), action: 'role.delete', before });
      return { success: true };
    });
  }

  /** The override editor for one user at one outlet: every permission, its source and the result. */
  async userPermissions(userId: string, outletId: string): Promise<OverrideRow[]> {
    const [catalogue, rows] = await Promise.all([
      this.db.select({ name: permissions.name }).from(permissions),
      this.rbac.rowsOf(userId, outletId),
    ]);
    return overrideRows(
      catalogue.map((p) => p.name),
      rows,
    );
  }

  /**
   * Grants, revokes or clears one permission for one person at several outlets, in one transaction.
   * The person must be a live member of every outlet named; the owner takes no overrides.
   */
  async setOverride(input: OverrideInput, actor: Actor): Promise<{ success: boolean }> {
    return this.db.transaction(async (tx) => {
      const outletIds = [...new Set(input.outletIds)];
      const [user] = await tx
        .select({ global: isNotNull(users.roleId) })
        .from(users)
        .where(and(eq(users.id, input.userId), isNull(users.deletedAt)));
      if (!user) throw staffNotFound();
      if (user.global) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });

      const memberships = await tx
        .select({ outletId: outletStaff.outletId })
        .from(outletStaff)
        .innerJoin(outlets, and(eq(outlets.id, outletStaff.outletId), isNull(outlets.deletedAt)))
        .where(and(eq(outletStaff.userId, input.userId), inArray(outletStaff.outletId, outletIds)));
      if (memberships.length !== outletIds.length) throw staffNotFound();

      const [permissionId] = await this.permissionIds(tx, [input.permission]);
      const here = and(
        eq(userPermissions.userId, input.userId),
        eq(userPermissions.permissionId, permissionId!),
        inArray(userPermissions.outletId, outletIds),
      );
      const before = new Map(
        (
          await tx
            .select({ outletId: userPermissions.outletId, effect: userPermissions.effect })
            .from(userPermissions)
            .where(here)
        ).map((r) => [r.outletId, r.effect]),
      );

      if (input.effect === null) await tx.delete(userPermissions).where(here);
      else
        await tx
          .insert(userPermissions)
          .values(
            outletIds.map((outletId) => ({
              userId: input.userId,
              outletId,
              permissionId: permissionId!,
              effect: input.effect!,
            })),
          )
          .onConflictDoUpdate({
            target: [userPermissions.userId, userPermissions.outletId, userPermissions.permissionId],
            set: { effect: input.effect },
          });

      // One row per outlet: each outlet's log shows its own change. A repeat diffs to nothing.
      for (const outletId of outletIds) {
        const was = before.get(outletId);
        await audit(tx, actor, {
          outletId,
          module: 'role',
          action: 'role.override',
          entityType: 'user',
          entityId: input.userId,
          before: was ? { [input.permission]: was } : undefined,
          after: input.effect ? { [input.permission]: input.effect } : undefined,
        });
      }
      return { success: true };
    });
  }

  /** The role row locked for the change, as its audit snapshot. Unknown → NOT_FOUND; a base role → refused. */
  private async editableRole(tx: Tx, id: string) {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
    if (!role) throw notFound();
    if (!role.editable)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Peran bawaan tidak bisa diubah.' });
    const held = await tx
      .select({ name: permissions.name })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, id));
    return snapshot(
      role,
      held.map((h) => h.name),
    );
  }

  /** Ids for the given names. One unknown name refuses the whole call. */
  private async permissionIds(tx: Tx, names: string[]): Promise<string[]> {
    const wanted = [...new Set(names)];
    if (!wanted.length) return [];
    const rows = await tx
      .select({ id: permissions.id, name: permissions.name })
      .from(permissions)
      .where(inArray(permissions.name, wanted));
    const known = new Set(rows.map((r) => r.name));
    const missing = wanted.find((name) => !known.has(name));
    if (missing) throw new TRPCError({ code: 'BAD_REQUEST', message: `Izin tidak dikenal: ${missing}.` });
    return rows.map((r) => r.id);
  }

  private async grant(tx: Tx, roleId: string, permissionIds: string[]): Promise<void> {
    if (permissionIds.length)
      await tx
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  }
}
