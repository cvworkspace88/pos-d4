/** A row as the service holds it: a drizzle select/returning result, or a hand-built snapshot. */
export type Snapshot = object | null | undefined;
type Row = Record<string, unknown>;

/** Never stored, not even hashed. A change still shows, masked, so "PIN changed" stays visible. */
const SECRET = new Set(['password', 'passwordHash', 'pin', 'pinHash']);
export const MASK = '•••';

/** Moves on every write, so it would turn every save — even one that changed nothing — into a diff. */
const IGNORED = new Set(['createdAt', 'updatedAt']);

/** JSON as Postgres will store it: Dates become ISO strings, undefined keys vanish. */
const json = (value: unknown): string => JSON.stringify(value ?? null);

const shown = (key: string, value: unknown): unknown =>
  SECRET.has(key) && value !== null && value !== undefined ? MASK : (JSON.parse(json(value)) as unknown);

const pick = (row: Row, keys: string[]): Row =>
  Object.fromEntries(keys.map((key) => [key, shown(key, row[key])]));

/**
 * What an audit row stores: only the fields that changed, secrets masked. A create has no
 * `before`, a delete no `after`. `null` means nothing changed — a repeat or retried save writes no row.
 */
export const auditDiff = (
  beforeRow: Snapshot,
  afterRow: Snapshot,
): { before: Row | null; after: Row | null } | null => {
  const before = beforeRow as Row | null | undefined;
  const after = afterRow as Row | null | undefined;
  const keysOf = (row: Row) => Object.keys(row).filter((key) => !IGNORED.has(key));
  if (!before && !after) return null;
  if (!before) return { before: null, after: pick(after!, keysOf(after!)) };
  if (!after) return { before: pick(before, keysOf(before)), after: null };

  const changed = [...new Set([...keysOf(before), ...keysOf(after)])].filter(
    (key) => json(before[key]) !== json(after[key]),
  );
  if (changed.length === 0) return null;
  return { before: pick(before, changed), after: pick(after, changed) };
};
