import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { permissions, rolePermissions, userPermissions, users } from '../db/schema';
import { type PermissionRow, effectivePermissions } from './rbac-rules';

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What the user's role grants, plus their per-user grants, minus their per-user revokes. Empty
   * for a user with no role and no overrides. One round trip: `require` runs on every gated call.
   */
  async permissionsOf(userId: string): Promise<string[]> {
    const fromRole = this.db
      .select({ name: permissions.name, source: sql<PermissionRow['source']>`'role'` })
      .from(users)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
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
  async require(userId: string, permission: string): Promise<void> {
    const held = await this.permissionsOf(userId);
    if (!held.includes(permission))
      throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${permission}.` });
  }
}
