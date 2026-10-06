import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { outlets } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { HubService } from './hub.service';

let db: TestDatabase;
let close: () => Promise<void>;
let hub: HubService;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  hub = new HubService(db, new ConfigService({ PORT: '4444' }));
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

test('before setup there is no outlet, but the port and addresses still answer', async () => {
  const info = await hub.info();
  expect(info.outlet).toBeNull();
  expect(info.port).toBe(4444);
  expect(Array.isArray(info.addresses)).toBe(true);
});

test('the hub is its first live outlet; a closed one is skipped', async () => {
  await db.insert(outlets).values({ name: 'Lama', code: 'OLD', deletedAt: new Date() });
  const [first] = await db.insert(outlets).values({ name: 'Kopi Senja', code: 'KS1' }).returning();
  await db.insert(outlets).values({ name: 'Cabang Dua', code: 'KS2' });
  expect((await hub.info()).outlet).toEqual({ id: first!.id, name: 'Kopi Senja' });
});
