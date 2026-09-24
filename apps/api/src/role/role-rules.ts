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
