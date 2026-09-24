import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { permissions, rolePermissions, roles } from '../db/schema';
import { permissionMatrix, type MatrixGroup } from './role-rules';

export interface RoleMatrix {
  roles: { id: string; name: string; description: string | null; permissionCount: number }[];
  groups: MatrixGroup[];
}

@Injectable()
export class RoleService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every role's grants, as the roles page draws them. Role grants only — per-user overrides are not here. */
  async matrix(): Promise<RoleMatrix> {
    const [roleRows, permissionRows, grants] = await Promise.all([
      this.db.select({ id: roles.id, name: roles.name, description: roles.description }).from(roles),
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
}
