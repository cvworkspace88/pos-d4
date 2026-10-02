import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { Actor } from '../auth/rbac-rules';
import { reservations, syncEvents, tables } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { ReservationService } from './reservation.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: ReservationService;
let actor: Actor;
let outletId: string;
let tableId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new ReservationService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  actor = await testActor(db);
  outletId = (await new OutletService(db).create({ name: 'Downtown', code: 'DT' }, actor)).id;
  tableId = (await db.insert(tables).values({ name: 'T1', outletId }).returning())[0]!.id;
});

const input = (id: string, customerName = 'Budi') => ({
  id,
  tableId,
  customerName,
  partySize: 4,
  startsAt: '2026-10-02T19:00:00+07:00',
});

test('a retried create returns the stored reservation and writes one row and one event', async () => {
  const id = randomUUID();
  const first = await service.create(actor, outletId, input(id));
  const retry = await service.create(actor, outletId, input(id, 'Sari')); // first wins

  expect(retry).toEqual(first);
  expect(await db.select().from(reservations)).toHaveLength(1);
  const events = await db.select().from(syncEvents);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outletId, type: 'reservation.upserted', entityId: id });
});

test('an update records reservation.upserted; a closed reservation refuses it', async () => {
  const id = randomUUID();
  await service.create(actor, outletId, input(id));
  await service.update(actor, outletId, id, { status: 'seated' });

  const events = await db.select().from(syncEvents);
  expect(events.map((e) => e.payload['status'])).toEqual(['booked', 'seated']);
  await expect(service.update(actor, outletId, id, { partySize: 2 })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
});

test('another outlet cannot see, edit or reuse the id of a reservation', async () => {
  const other = (await new OutletService(db).create({ name: 'Uptown', code: 'UP' }, actor)).id;
  const id = randomUUID();
  await service.create(actor, outletId, input(id));

  expect(await service.list(other, '2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z')).toEqual([]);
  await expect(service.update(actor, other, id, { partySize: 2 })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  // Its table is not the other outlet's either.
  await expect(service.create(actor, other, input(randomUUID()))).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
