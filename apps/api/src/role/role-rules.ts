import { effectivePermissions, type PermissionRow } from '../auth/rbac-rules';

export interface MatrixRow {
  /** The permission name. */
  key: string;
  description: string | null;
  /** One entry per role, in the order the roles were given: does it hold this permission? */
  granted: boolean[];
}

export interface MatrixGroup {
  /** The part before the dot: `sales`, `table`, … */
  domain: string;
  rows: MatrixRow[];
}

/**
 * The flat permission list as the matrix the roles page draws: one row per permission, a request
 * and its approve included, sorted by name and grouped by domain in first-seen order.
 */
export function permissionMatrix(
  permissions: { name: string; description: string | null }[],
  held: Set<string>[],
): MatrixGroup[] {
  const groups = new Map<string, MatrixRow[]>();
  for (const { name, description } of [...permissions].sort((a, b) => a.name.localeCompare(b.name))) {
    const domain = name.split('.')[0]!;
    groups.set(domain, [
      ...(groups.get(domain) ?? []),
      { key: name, description, granted: held.map((h) => h.has(name)) },
    ]);
  }
  return [...groups].map(([domain, rows]) => ({ domain, rows }));
}

/** One line of the per-user override editor: where the permission comes from, and the result. */
export interface OverrideRow {
  permission: string;
  fromRole: boolean;
  override: 'grant' | 'revoke' | null;
  effective: boolean;
}

/** Every catalogue permission as the editor shows it for one user at one outlet, sorted by name. */
export function overrideRows(catalogue: string[], rows: PermissionRow[]): OverrideRow[] {
  const effective = new Set(effectivePermissions(rows));
  return [...catalogue].sort().map((permission) => {
    const override = rows.find((r) => r.name === permission && r.source !== 'role')?.source;
    return {
      permission,
      fromRole: rows.some((r) => r.name === permission && r.source === 'role'),
      override: override === 'grant' || override === 'revoke' ? override : null,
      effective: effective.has(permission),
    };
  });
}
