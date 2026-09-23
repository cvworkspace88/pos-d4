import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { outletStaff, outlets, permissions, rolePermissions, userPermissions, users } from '../db/schema';
import { type Actor, type PermissionRow, effectivePermissions } from './rbac-rules';

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What the user's role at `outletId` grants, plus their per-user grants, minus their per-user
   * revokes. The role is `users.role_id` when set (global — owner), otherwise the `outlet_staff`
   * row for that outlet. No outlet and no global role means no role permissions at all; only
   * grants survive. One round trip: `require` runs on every gated call.
   */
  async permissionsOf(userId: string, outletId: string | null): Promise<string[]> {
    // `sql\`false\`` keeps the join shape identical when there is no outlet to match: the left join
    // yields nulls, coalesce falls through to users.role_id, and a scoped user gets nothing.
    const membership = outletId
      ? and(
          eq(outletStaff.outletId, outletId),
          // A closed outlet grants nothing, even to a token minted before it closed.
          sql`exists (select 1 from ${outlets} where ${outlets.id} = ${outletStaff.outletId} and ${outlets.deletedAt} is null)`,
        )
      : sql`false`;
    const roleId = sql`coalesce(${users.roleId}, ${outletStaff.roleId})`;

    const fromRole = this.db
      .select({ name: permissions.name, source: sql<PermissionRow['source']>`'role'` })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), membership))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(users.id, userId));

    const fromOverrides = this.db
      .select({
        name: permissions.name,
        // The stored effect *is* the source tag: 'grant' and 'revoke' need no mapping.
        source: sql<PermissionRow['source']>`${userPermissions.effect}`,
      })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(eq(userPermissions.userId, userId));

    return effectivePermissions(await unionAll(fromRole, fromOverrides));
  }

  /** FORBIDDEN, not UNAUTHORIZED: we know who this is, they just may not do this. */
  async require(actor: Actor, permission: string): Promise<void> {
    const held = await this.permissionsOf(actor.user.id, actor.outletId);
    if (!held.includes(permission))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Anda tidak memiliki akses.',
      });
  }
}
