import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { permissions, rolePermissions, users } from '../db/schema';

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every permission name the user's role grants. Empty for a user with no role. */
  async permissionsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: permissions.name })
      .from(users)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(users.id, userId));
    return rows.map((row) => row.name);
  }

  /** FORBIDDEN, not UNAUTHORIZED: we know who this is, they just may not do this. */
  async require(userId: string, permission: string): Promise<void> {
    const held = await this.permissionsOf(userId);
    if (!held.includes(permission))
      throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${permission}.` });
  }
}
