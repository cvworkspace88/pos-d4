import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { CategoryService } from '../category/category.service';
import { menuItems } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { MenuService, type MenuItemInput } from './menu.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: MenuService;
let categories: CategoryService;
let outlets: OutletService;
let outletId: string;
let makananId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new MenuService(db);
  categories = new CategoryService(db);
  outlets = new OutletService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  outletId = (await outlets.create({ name: 'Downtown', code: 'DT' })).id;
  makananId = (await categories.create(outletId, 'Makanan')).id;
});

const item = (over: Partial<MenuItemInput> = {}): MenuItemInput => ({
  categoryId: makananId,
  name: 'Nasi Goreng',
  price: 35000,
  cost: 12000,
  tax: 'pbjt',
  available: true,
  ...over,
});

test('create returns the item with its category name, and list shows it', async () => {
  const created = await service.create(outletId, item());
  expect(created).toMatchObject({ name: 'Nasi Goreng', categoryName: 'Makanan', price: 35000, cost: 12000 });
  expect(await service.list(outletId)).toEqual([created]);
});

test('list follows the category order, then the name', async () => {
  const minuman = (await categories.create(outletId, 'Minuman')).id;
  await service.create(outletId, item({ name: 'Es Teh', categoryId: minuman }));
  await service.create(outletId, item({ name: 'Mie Ayam' }));
  await service.create(outletId, item({ name: 'Ayam Geprek' }));
  await categories.reorder(outletId, [minuman, makananId]);
  expect((await service.list(outletId)).map((m) => m.name)).toEqual(['Es Teh', 'Ayam Geprek', 'Mie Ayam']);
});

test('a duplicate live name at the same outlet is a CONFLICT', async () => {
  await service.create(outletId, item());
  await expect(service.create(outletId, item())).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama menu sudah dipakai.',
  });
});

test('update saves every field; an omitted cost is cleared', async () => {
  const created = await service.create(outletId, item());
  const saved = await service.update(outletId, created.id, item({ price: 38000, cost: null, tax: 'none' }));
  expect(saved).toMatchObject({ price: 38000, cost: null, tax: 'none' });
});

test('setAvailable flips only the sold-out switch', async () => {
  const created = await service.create(outletId, item());
  expect(await service.setAvailable(outletId, created.id, false)).toEqual({
    id: created.id,
    available: false,
  });
  expect(await service.list(outletId)).toEqual([{ ...created, available: false }]);
});

test("another outlet's item is NOT_FOUND, and its category cannot be used", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const theirCategory = (await categories.create(other, 'Makanan')).id;
  const theirs = await service.create(other, item({ categoryId: theirCategory }));

  expect(await service.list(outletId)).toEqual([]);
  await expect(service.update(outletId, theirs.id, item())).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Menu tidak ditemukan.',
  });
  await expect(service.setAvailable(outletId, theirs.id, false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.delete(outletId, theirs.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.create(outletId, item({ categoryId: theirCategory }))).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Kategori tidak ditemukan.',
  });
});

test('a category holding live items refuses to be deleted', async () => {
  await service.create(outletId, item());
  await expect(categories.delete(outletId, makananId)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Kategori masih berisi menu. Pindahkan menu ke kategori lain dulu.',
  });
  expect((await categories.list(outletId)).map((c) => c.name)).toEqual(['Makanan']);
});

test('delete is soft: the row stays, the item leaves the list, and its name can be reused', async () => {
  const created = await service.create(outletId, item());
  await service.delete(outletId, created.id);
  expect(await service.list(outletId)).toEqual([]);
  const [row] = await db.select().from(menuItems).where(eq(menuItems.id, created.id));
  expect(row?.deletedAt).toBeInstanceOf(Date);
  await expect(service.delete(outletId, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await service.create(outletId, item());
});

test('a category whose items are all deleted can be deleted', async () => {
  const created = await service.create(outletId, item());
  await service.delete(outletId, created.id);
  await expect(categories.delete(outletId, makananId)).resolves.toEqual({ success: true });
});

test('taxRates reads the outlet PBJT rate and the deployment PPN rate', async () => {
  expect(await service.taxRates(outletId)).toEqual({ pbjtRateBp: 1000, ppnRateBp: 1100 });
});
