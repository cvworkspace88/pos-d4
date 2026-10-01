import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { kitchenStations } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { CategoryService, type CategoryInput } from './category.service';

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

const names = async (at = outletId) => (await service.list(at)).map((c) => c.name);

const fields = (over: Partial<CategoryInput> = {}): CategoryInput => ({
  name: 'Makanan',
  color: null,
  active: true,
  kitchenStationId: null,
  ...over,
});

/** No station API yet (US-036): tests seed the table directly. */
const station = async (name: string, active = true, at = outletId): Promise<string> =>
  (
    await db
      .insert(kitchenStations)
      .values({ outletId: at, name, active })
      .returning({ id: kitchenStations.id })
  )[0]!.id;

test('create appends at the end, with the defaults', async () => {
  await service.create(outletId, 'Makanan');
  await service.create(outletId, 'Minuman', '#1E90FF');
  expect(await service.list(outletId)).toMatchObject([
    { name: 'Makanan', sortOrder: 0, color: null, active: true, kitchenStationId: null, itemCount: 0 },
    { name: 'Minuman', sortOrder: 1, color: '#1E90FF' },
  ]);
});

test('a duplicate live name at the same outlet is a CONFLICT', async () => {
  await service.create(outletId, 'Makanan');
  await expect(service.create(outletId, 'Makanan')).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama kategori sudah dipakai.',
  });
});

test("each outlet has its own categories; another outlet's is invisible and NOT_FOUND", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  await service.create(outletId, 'Makanan');
  // Same name at another outlet is no conflict, and positions count per outlet.
  const theirs = await service.create(other, 'Makanan');
  expect(theirs.sortOrder).toBe(0);
  expect(await names()).toEqual(['Makanan']);
  expect(await names(other)).toEqual(['Makanan']);

  const notFound = { code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' };
  await expect(service.update(outletId, theirs.id, fields({ name: 'X' }))).rejects.toMatchObject(notFound);
  await expect(service.delete(outletId, theirs.id)).rejects.toMatchObject(notFound);
  expect(await names(other)).toEqual(['Makanan']);
});

test('a deleted category is not listed, and its name can be reused', async () => {
  const c = await service.create(outletId, 'Makanan');
  await service.delete(outletId, c.id);
  expect(await names()).toEqual([]);
  await service.create(outletId, 'Makanan');
  expect(await names()).toEqual(['Makanan']);
});

test('update saves every field; a rename onto a live name is a CONFLICT', async () => {
  const bar = await station('Bar');
  const c = await service.create(outletId, 'Makanan');
  await service.create(outletId, 'Minuman');
  expect(
    await service.update(
      outletId,
      c.id,
      fields({ name: 'Makanan Berat', color: '#FF8800', active: false, kitchenStationId: bar }),
    ),
  ).toEqual({
    id: c.id,
    name: 'Makanan Berat',
    sortOrder: 0,
    color: '#FF8800',
    active: false,
    kitchenStationId: bar,
  });
  await expect(service.update(outletId, c.id, fields({ name: 'Minuman' }))).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama kategori sudah dipakai.',
  });
});

test("an unknown, retired or another outlet's station is NOT_FOUND, and nothing is written", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const retired = await station('Grill', false);
  const theirs = await station('Bar', true, other);
  const c = await service.create(outletId, 'Makanan');
  const notFound = { code: 'NOT_FOUND', message: 'Stasiun dapur tidak ditemukan.' };
  for (const kitchenStationId of [retired, theirs, '00000000-0000-0000-0000-000000000000'])
    await expect(
      service.update(outletId, c.id, fields({ name: 'X', kitchenStationId })),
    ).rejects.toMatchObject(notFound);
  expect((await service.list(outletId))[0]).toMatchObject({ name: 'Makanan', kitchenStationId: null });
});

test('a deleted category is NOT_FOUND for update and for a second delete', async () => {
  const c = await service.create(outletId, 'Makanan');
  await service.delete(outletId, c.id);
  const notFound = { code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' };
  await expect(service.update(outletId, c.id, fields())).rejects.toMatchObject(notFound);
  await expect(service.delete(outletId, c.id)).rejects.toMatchObject(notFound);
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
