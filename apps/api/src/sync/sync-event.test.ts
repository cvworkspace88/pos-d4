import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { Actor } from '../auth/rbac-rules';
import { categories, syncEvents } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { createOnce, recordSyncEvent } from './sync-event';
import { SyncService } from './sync.service';

let db: TestDatabase;
let close: () => Promise<void>;
let actor: Actor;
let outletId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  actor = await testActor(db);
  outletId = (await new OutletService(db).create({ name: 'Downtown', code: 'DT' }, actor)).id;
});

// Categories stand in for a transactional entity: none exists yet (orders arrive with US-026).
const create = (id: string, name = 'Kopi') =>
  db.transaction((tx) =>
    createOnce(
      tx,
      actor,
      categories,
      { id, outletId, name, sortOrder: 0 },
      { outletId, type: 'category.created' },
    ),
  );

test('the same create twice stores one row and one event, and returns the stored row both times', async () => {
  const id = randomUUID();
  const first = await create(id);
  const retry = await create(id, 'Teh'); // a retry that differs is still the same request: first wins

  expect(first.created).toBe(true);
  expect(retry).toEqual({ row: first.row, created: false });
  expect(await db.select().from(categories)).toHaveLength(1);

  const events = await db.select().from(syncEvents);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    outletId,
    type: 'category.created',
    entityId: id,
    actorUserId: actor.user.id,
  });
  expect(events[0]!.payload).toMatchObject({ id, name: 'Kopi', outletId });
});

test('concurrent duplicates still store one row and one event', async () => {
  const id = randomUUID();
  const results = await Promise.all([create(id), create(id), create(id)]);
  expect(results.filter((r) => r.created)).toHaveLength(1);
  expect(await db.select().from(syncEvents)).toHaveLength(1);
});

test('a rolled-back change leaves no event behind', async () => {
  await expect(
    db.transaction(async (tx) => {
      await recordSyncEvent(tx, actor, {
        outletId,
        type: 'order.created',
        entityId: randomUUID(),
        payload: {},
      });
      throw new Error('payment failed');
    }),
  ).rejects.toThrow('payment failed');
  expect(await db.select().from(syncEvents)).toHaveLength(0);
});

test('pendingCount counts only unsynced events of the outlet', async () => {
  const other = (await new OutletService(db).create({ name: 'Uptown', code: 'UT' }, actor)).id;
  const event = (outlet: string) => ({
    outletId: outlet,
    type: 'order.created' as const,
    entityId: randomUUID(),
    payload: {},
  });
  const pushed = event(outletId);
  await recordSyncEvent(db, actor, pushed);
  await recordSyncEvent(db, actor, event(outletId));
  await recordSyncEvent(db, actor, event(other));
  await db.update(syncEvents).set({ syncedAt: new Date() }).where(eq(syncEvents.entityId, pushed.entityId));

  expect(await new SyncService(db).pendingCount(outletId)).toBe(1);
  expect(await new SyncService(db).pendingCount(other)).toBe(1);
});

test("an id already stored at another outlet is CONFLICT, never the other outlet's row", async () => {
  const other = (await new OutletService(db).create({ name: 'Uptown', code: 'UP' }, actor)).id;
  const id = randomUUID();
  await create(id);

  await expect(
    db.transaction((tx) =>
      createOnce(
        tx,
        actor,
        categories,
        { id, outletId: other, name: 'Kopi', sortOrder: 0 },
        { outletId: other, type: 'category.created' },
      ),
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
