/** A permission name plus where it came from: the user's role, or a per-user override row. */
export type PermissionRow = { name: string; source: 'role' | 'grant' | 'revoke' };

/**
 * Get users permissions from roles and override permissions.
 * @return list of granted permissions 
 */
export const effectivePermissions = (rows: PermissionRow[]): string[] => {
  const held = new Set(rows.filter((row) => row.source !== 'revoke').map((row) => row.name));
  for (const row of rows) if (row.source === 'revoke') held.delete(row.name);
  return [...held].sort();
};
