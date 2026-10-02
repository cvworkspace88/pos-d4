import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { Actor } from '../auth/rbac-rules';
import { auditLog, tables } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { TableService } from './table.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: TableService;
let outletId: string;
let owner: Actor;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new TableService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  owner = await testActor(db);
  outletId = (await new OutletService(db).create({ name: 'Downtown', code: 'DT' }, owner)).id;
});

// Creating the outlet writes its own audit row; these tests look at approvals only.
const approvalRows = () => db.select().from(auditLog).where(eq(auditLog.module, 'approval'));

const addTable = async (name: string, outlet = outletId) =>
  (await db.insert(tables).values({ name, outletId: outlet }).returning())[0]!;

test('an approved merge writes one approval.granted row naming the approver', async () => {
  const actor = await testActor(db, false);
  const approverUserId = owner.user.id;
  const a = await addTable('A');
  const b = await addTable('B');

  await service.merge(outletId, a.id, [b.id], {
    actor,
    permission: 'table.merge',
    approverUserId,
    reason: 'ramai',
  });

  const rows = await approvalRows();
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
  const approverUserId = owner.user.id;
  const a = await addTable('A');
  const b = await addTable('B');
  await service.merge(outletId, a.id, [b.id]);

  await service.unmerge(outletId, a.id, { actor, permission: 'table.merge', approverUserId });

  const rows = await approvalRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: 'approval.granted', entityId: a.id, approverUserId });
  expect((await service.list(outletId)).every((t) => t.mergedIntoId === null)).toBe(true);
});

test('a merge without an approval writes no audit row', async () => {
  const a = await addTable('A');
  const b = await addTable('B');
  await service.merge(outletId, a.id, [b.id]);
  expect(await approvalRows()).toHaveLength(0);
});

test("another outlet never sees, merges or reuses the name of this outlet's tables", async () => {
  const other = (await new OutletService(db).create({ name: 'Uptown', code: 'UP' }, owner)).id;
  const a = await addTable('A');
  const b = await addTable('B', other);

  expect((await service.list(other)).map((t) => t.name)).toEqual(['B']);
  await expect(service.merge(outletId, a.id, [b.id])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    service.create(other, { name: 'A', seats: 2, x: 0, y: 0, w: 100, h: 100 }),
  ).resolves.toMatchObject({
    name: 'A',
  });
});
