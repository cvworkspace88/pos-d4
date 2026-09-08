import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLOOR,
  RESERVED_LEAD_MS,
  clampPosition,
  dayRange,
  groupsOf,
  isReserved,
  nextFullHourLocal,
  scaleFor,
  seatsOf,
} from './floor.ts';

const table = (id: string, seats: number, mergedIntoId: string | null = null) => ({
  id,
  seats,
  w: 100,
  h: 100,
  mergedIntoId,
});

test('scale is uniform and follows the shorter side', () => {
  assert.equal(scaleFor(500, 1000), 0.5);
  assert.equal(scaleFor(1000, 250), 0.25);
  assert.equal(scaleFor(0, 0), 0);
});

test('clamp keeps the whole table inside the canvas and rounds', () => {
  const t = { w: 100, h: 50 };
  assert.deepEqual(clampPosition(t, -5, -5), { x: 0, y: 0 });
  assert.deepEqual(clampPosition(t, 950, 980), { x: FLOOR.size - 100, y: FLOOR.size - 50 });
  assert.deepEqual(clampPosition(t, 10.4, 10.6), { x: 10, y: 11 });
});

test('groupsOf maps a head to its members and ignores standalone tables', () => {
  const groups = groupsOf([table('H', 4), table('A', 2, 'H'), table('B', 2, 'H'), table('S', 6)]);
  assert.deepEqual([...groups.entries()], [['H', ['A', 'B']]]);
});

test('seatsOf sums the head and its members, a member counts only itself', () => {
  const tables = [table('H', 4), table('A', 2, 'H'), table('B', 2, 'H'), table('S', 6)];
  assert.equal(seatsOf('H', tables), 8);
  assert.equal(seatsOf('A', tables), 2);
  assert.equal(seatsOf('S', tables), 6);
});

const NOW = new Date(Date.UTC(2026, 8, 7, 12, 0, 0));
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

test('reserved from 30 minutes before the booking', () => {
  const soon = [{ tableId: 'T', status: 'booked', startsAt: at(29 * 60 * 1000) }];
  const later = [{ tableId: 'T', status: 'booked', startsAt: at(31 * 60 * 1000) }];
  assert.equal(isReserved('T', soon, NOW), true);
  assert.equal(isReserved('T', later, NOW), false);
  assert.equal(RESERVED_LEAD_MS, 30 * 60 * 1000);
});

test('a booking already past its time still shows until staff resolve it', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'booked', startsAt: at(-60 * 60 * 1000) }], NOW), true);
});

test('seated, cancelled and no-show bookings and other tables do not count', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'seated', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'cancelled', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'no_show', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'U', status: 'booked', startsAt: at(0) }], NOW), false);
});

test('isReserved accepts Date as well as ISO string', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'booked', startsAt: NOW }], NOW), true);
});

test('dayRange spans local midnight to the next one', () => {
  const now = new Date(2026, 8, 7, 15, 45); // local time
  const { from, to } = dayRange(now);
  assert.equal(new Date(from).getHours(), 0);
  assert.equal(new Date(from).getDate(), 7);
  assert.equal(new Date(to).getDate(), 8);
  assert.equal(new Date(to).getHours(), 0);
});

test('nextFullHourLocal formats the next full hour for a datetime-local input', () => {
  assert.equal(nextFullHourLocal(new Date(2026, 8, 7, 15, 45)), '2026-09-07T16:00');
  assert.equal(nextFullHourLocal(new Date(2026, 8, 7, 23, 10)), '2026-09-08T00:00');
});
