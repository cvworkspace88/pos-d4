import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { CategoryService } from './category.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: CategoryService;
let outlets: OutletService;
let outletId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new CategoryService(db);
  outlets = new OutletService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  outletId = (await outlets.create({ name: 'Downtown', code: 'DT' })).id;
});

const names = async (id = outletId) => (await service.list(id)).map((c) => c.name);

test('create appends at the end', async () => {
  await service.create(outletId, 'Makanan');
  await service.create(outletId, 'Minuman');
  expect(await service.list(outletId)).toMatchObject([
    { name: 'Makanan', sortOrder: 0 },
    { name: 'Minuman', sortOrder: 1 },
  ]);
});

test('a duplicate live name at the same outlet is a CONFLICT', async () => {
  await service.create(outletId, 'Makanan');
  await expect(service.create(outletId, 'Makanan')).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama kategori sudah dipakai.',
  });
});

test('another outlet may use the same name, and does not see this one', async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  await service.create(outletId, 'Makanan');
  await service.create(other, 'Makanan');
  expect(await names(other)).toEqual(['Makanan']);
  expect(await names()).toEqual(['Makanan']);
});

test('a deleted category is not listed, and its name can be reused', async () => {
  const c = await service.create(outletId, 'Makanan');
  await service.delete(outletId, c.id);
  expect(await names()).toEqual([]);
  await service.create(outletId, 'Makanan');
  expect(await names()).toEqual(['Makanan']);
});

test('rename saves the new name; a rename onto a live name is a CONFLICT', async () => {
  const c = await service.create(outletId, 'Makanan');
  await service.create(outletId, 'Minuman');
  expect((await service.rename(outletId, c.id, 'Makanan Berat')).name).toBe('Makanan Berat');
  await expect(service.rename(outletId, c.id, 'Minuman')).rejects.toMatchObject({ code: 'CONFLICT' });
});

test("another outlet's category is NOT_FOUND for rename and delete", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const c = await service.create(other, 'Makanan');
  const notFound = { code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' };
  await expect(service.rename(outletId, c.id, 'X')).rejects.toMatchObject(notFound);
  await expect(service.delete(outletId, c.id)).rejects.toMatchObject(notFound);
});

test('a deleted category is NOT_FOUND on a second delete', async () => {
  const c = await service.create(outletId, 'Makanan');
  await service.delete(outletId, c.id);
  await expect(service.delete(outletId, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('reorder persists the new order', async () => {
  const a = await service.create(outletId, 'Minuman');
  const b = await service.create(outletId, 'Makanan');
  const c = await service.create(outletId, 'Snack');
  const saved = await service.reorder(outletId, [b.id, a.id, c.id]);
  expect(saved.map((x) => x.name)).toEqual(['Makanan', 'Minuman', 'Snack']);
  expect(await names()).toEqual(['Makanan', 'Minuman', 'Snack']);
});

test('reorder with a stale id list is a CONFLICT and changes nothing', async () => {
  const a = await service.create(outletId, 'Minuman');
  const b = await service.create(outletId, 'Makanan');
  await service.create(outletId, 'Snack'); // added by another tablet after the client loaded
  await expect(service.reorder(outletId, [b.id, a.id])).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Urutan kategori berubah. Muat ulang lalu coba lagi.',
  });
  expect(await names()).toEqual(['Minuman', 'Makanan', 'Snack']);
});
