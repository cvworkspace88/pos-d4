import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { auditLog, tables } from '../db/schema';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { TableService } from './table.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: TableService;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new TableService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const addTable = async (name: string) => (await db.insert(tables).values({ name }).returning())[0]!;

test('an approved merge writes one approval.granted row naming the approver', async () => {
  const actor = await testActor(db, false);
  const approverUserId = (await testActor(db, true)).user.id;
  const a = await addTable('A');
  const b = await addTable('B');

  await service.merge(a.id, [b.id], { actor, permission: 'table.merge', approverUserId, reason: 'ramai' });

  const rows = await db.select().from(auditLog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    module: 'approval',
    action: 'approval.granted',
    entityType: 'table',
    entityId: a.id,
    actorUserId: actor.user.id,
    approverUserId,
    reason: 'ramai',
    after: { permission: 'table.merge' },
  });
});

test('an approved unmerge is audited in the same transaction', async () => {
  const actor = await testActor(db, false);
  const approverUserId = (await testActor(db, true)).user.id;
  const a = await addTable('A');
  const b = await addTable('B');
  await service.merge(a.id, [b.id]);

  await service.unmerge(a.id, { actor, permission: 'table.merge', approverUserId });

  const rows = await db.select().from(auditLog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: 'approval.granted', entityId: a.id, approverUserId });
  expect((await service.list()).every((t) => t.mergedIntoId === null)).toBe(true);
});

test('a merge without an approval writes no audit row', async () => {
  const a = await addTable('A');
  const b = await addTable('B');
  await service.merge(a.id, [b.id]);
  expect(await db.select().from(auditLog)).toHaveLength(0);
});
