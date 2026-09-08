export interface RuleTable {
  id: string;
  mergedIntoId: string | null;
}

export interface RuleReservation {
  tableId: string;
  status: string;
}

export const UNMERGE_FIRST = 'Unmerge first.';
export const HAS_BOOKED = 'Has a booked reservation.';

const isHead = (id: string, tables: RuleTable[]) => tables.some((t) => t.mergedIntoId === id);

/**
 * Why `members` cannot be merged into `head`, or null if they can. `tables` is every live table.
 *
 * Groups are one level deep: a head may already have members (the group grows), but a member can
 * be neither head nor member of anything else, and a head cannot become a member. That keeps
 * `unmerge` a single UPDATE with no cascade.
 *
 * Pure and decorator-free so `node --test` can import it — same reason `pin-policy.ts` exists.
 */
export function rejectMerge(head: RuleTable, members: RuleTable[], tables: RuleTable[]): string | null {
  if (head.mergedIntoId) return UNMERGE_FIRST;
  for (const member of members) {
    if (member.mergedIntoId || isHead(member.id, tables)) return UNMERGE_FIRST;
  }
  return null;
}

/** Why `table` cannot be soft-deleted, or null. Merge membership is checked before reservations. */
export function rejectDelete(
  table: RuleTable,
  tables: RuleTable[],
  reservations: RuleReservation[],
): string | null {
  if (table.mergedIntoId || isHead(table.id, tables)) return UNMERGE_FIRST;
  if (reservations.some((r) => r.tableId === table.id && r.status === 'booked')) return HAS_BOOKED;
  return null;
}
