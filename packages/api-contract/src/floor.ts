/**
 * Floor geometry and derived state shared by desktop and tablet. Pure so `node --test` can import
 * it — same reason `refresh.ts` lives in this package.
 *
 * Structural types on purpose: `table.list` and `reservation.list` rows satisfy them, but this
 * module never imports the generated router.
 */
export interface FloorTable {
  id: string;
  seats: number;
  w: number;
  h: number;
  mergedIntoId: string | null;
}

export interface FloorReservation {
  tableId: string;
  status: string;
  startsAt: Date | string;
}

/** Virtual canvas in table units. Both clients scale it uniformly, so a table lands in the same place on each. */
export const FLOOR = { size: 1000, minSide: 40, maxSide: 500 } as const;

/** A table reads "Reserved" this long before its booking. */
export const RESERVED_LEAD_MS = 30 * 60 * 1000;

export function scaleFor(viewportW: number, viewportH: number): number {
  return Math.max(0, Math.min(viewportW, viewportH)) / FLOOR.size;
}

export function clampPosition(table: { w: number; h: number }, x: number, y: number): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max);
  return { x: clamp(x, FLOOR.size - table.w), y: clamp(y, FLOOR.size - table.h) };
}

/** head id -> member ids. A table with nobody pointing at it is absent. */
export function groupsOf(tables: FloorTable[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const table of tables) {
    if (!table.mergedIntoId) continue;
    const members = groups.get(table.mergedIntoId) ?? [];
    members.push(table.id);
    groups.set(table.mergedIntoId, members);
  }
  return groups;
}

/** Seats of the table plus everything merged into it. For a member or standalone table: its own seats. */
export function seatsOf(headId: string, tables: FloorTable[]): number {
  return tables
    .filter((t) => t.id === headId || t.mergedIntoId === headId)
    .reduce((sum, t) => sum + t.seats, 0);
}

/** True while a booked reservation is due within `RESERVED_LEAD_MS`, or overdue and not yet resolved. */
export function isReserved(tableId: string, reservations: FloorReservation[], now: Date): boolean {
  const limit = now.getTime() + RESERVED_LEAD_MS;
  return reservations.some(
    (r) => r.tableId === tableId && r.status === 'booked' && new Date(r.startsAt).getTime() <= limit,
  );
}

/** The device's local day as an ISO window `[from, to)` for `reservation.list`. */
export function dayRange(now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** `YYYY-MM-DDTHH:mm` local, the value format of `<input type="datetime-local">`. */
export function nextFullHourLocal(now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
