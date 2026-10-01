import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { events } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';

let db: TestDatabase;
let close: () => Promise<void>;
let outletId: string;
let actorId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  const actor = await testActor(db);
  actorId = actor.user.id;
  outletId = (await new OutletService(db).create({ name: 'Downtown', code: 'DT' }, actor)).id;
});

const event = (type = 'order.created') => ({
  outletId,
  type,
  entityId: randomUUID(),
  payload: { pax: 2 },
  actorUserId: actorId,
});

test('ids are UUID v7 and seq follows insert order', async () => {
  const rows = await db.insert(events).values([event(), event('order.line_added')]).returning();
  expect(rows.map((r) => r.id[14])).toEqual(['7', '7']);
  expect(rows[1]!.seq).toBe(rows[0]!.seq + 1);
  expect(rows.every((r) => r.syncedAt === null)).toBe(true);
});

test('the cloud can store an outlet event with its own id and seq, once', async () => {
  const pushed = { ...event(), id: '0192e1a0-0000-7000-8000-000000000001', seq: 101 };
  await db.insert(events).values(pushed);
  await expect(db.insert(events).values(pushed)).rejects.toThrow();
  await expect(db.insert(events).values({ ...pushed, id: randomUUID() })).rejects.toThrow();
});

test('only synced_at may change: other updates and deletes are refused', async () => {
  await db.insert(events).values(event());
  await db.update(events).set({ syncedAt: new Date() });

  const refusal = { cause: { message: 'events is append-only' } };
  await expect(db.update(events).set({ payload: { pax: 3 } })).rejects.toMatchObject(refusal);
  await expect(db.delete(events)).rejects.toMatchObject(refusal);
  await expect(db.execute(sql`delete from events`)).rejects.toMatchObject(refusal);
});

test('type must be entity.verb', async () => {
  await expect(db.insert(events).values(event('OrderCreated'))).rejects.toThrow();
});
