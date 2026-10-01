import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { AddonService, type AddonGroupInput } from '../addon/addon.service';
import { CategoryService } from '../category/category.service';
import { kitchenStations, menuItems, menuVariants, outlets as outletRows } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { MenuService, type MenuItemInput } from './menu.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: MenuService;
let categories: CategoryService;
let addons: AddonService;
let outlets: OutletService;
let outletId: string;
let makananId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  categories = new CategoryService(db);
  addons = new AddonService(db);
  outlets = new OutletService(db);
  service = new MenuService(db, categories, addons);
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
  code: null,
  name: 'Nasi Goreng',
  kitchenName: null,
  description: null,
  imageUrl: null,
  price: 35000,
  cost: 12000,
  tax: 'pbjt',
  kitchenStationId: null,
  soldBy: 'unit',
  active: true,
  variants: [],
  addonGroupIds: [],
  ...over,
});

const group = (name: string): AddonGroupInput => ({
  name,
  minSelect: 0,
  maxSelect: 1,
  options: [{ name: 'Ya', price: 0, available: true }],
});

/** No station API yet (US-036): tests seed the table directly. */
const station = async (name: string, active = true, at = outletId): Promise<string> =>
  (
    await db
      .insert(kitchenStations)
      .values({ outletId: at, name, active })
      .returning({ id: kitchenStations.id })
  )[0]!.id;

const names = async () => (await service.items(outletId)).map((m) => m.name);

test("create returns the item with its category name and defaults; list carries the outlet's whole menu", async () => {
  const created = await service.create(outletId, item());
  expect(created).toMatchObject({
    name: 'Nasi Goreng',
    categoryName: 'Makanan',
    price: 35000,
    cost: 12000,
    kitchenName: null,
    soldBy: 'unit',
    sortOrder: 0,
    active: true,
    stationId: null,
  });
  const menu = await service.list(outletId);
  expect(menu.items).toEqual([created]);
  expect(menu.categories).toMatchObject([{ id: makananId, name: 'Makanan', itemCount: 1 }]);
  expect(menu.addonGroups).toEqual([]);
});

test('items follow the category order, then the item order, then the name', async () => {
  const minuman = (await categories.create(outletId, 'Minuman')).id;
  await service.create(outletId, item({ name: 'Es Teh', categoryId: minuman }));
  await service.create(outletId, item({ name: 'Mie Ayam' }));
  const geprek = await service.create(outletId, item({ name: 'Ayam Geprek' }));
  await categories.reorder(outletId, [minuman, makananId]);
  expect(await names()).toEqual(['Es Teh', 'Ayam Geprek', 'Mie Ayam']);
  // sort_order has no writer yet; prove the ORDER BY honours it anyway.
  await db.update(menuItems).set({ sortOrder: 5 }).where(eq(menuItems.id, geprek.id));
  expect(await names()).toEqual(['Es Teh', 'Mie Ayam', 'Ayam Geprek']);
});

test('a duplicate live name at the same outlet is a CONFLICT', async () => {
  await service.create(outletId, item());
  await expect(service.create(outletId, item())).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama menu sudah dipakai.',
  });
});

test("each outlet has its own menu; another outlet's item and category cannot be used", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const theirCategory = (await categories.create(other, 'Makanan')).id;
  // Same name and code at another outlet is no conflict.
  const theirs = await service.create(other, item({ categoryId: theirCategory, code: 'NG-01' }));
  await service.create(outletId, item({ code: 'NG-01' }));

  expect((await service.list(other)).items.map((m) => m.id)).toEqual([theirs.id]);
  expect((await service.list(outletId)).categories.map((c) => c.id)).toEqual([makananId]);
  const notFound = { code: 'NOT_FOUND', message: 'Menu tidak ditemukan.' };
  await expect(service.update(outletId, theirs.id, item({ name: 'Lain' }))).rejects.toMatchObject(notFound);
  await expect(service.setActive(outletId, theirs.id, false)).rejects.toMatchObject(notFound);
  await expect(service.delete(outletId, theirs.id)).rejects.toMatchObject(notFound);
  await expect(
    service.create(outletId, item({ name: 'Lain', categoryId: theirCategory })),
  ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });
  expect((await service.items(other))[0]).toMatchObject({ id: theirs.id, active: true });
});

test('update saves every field; an omitted cost is cleared', async () => {
  const created = await service.create(outletId, item());
  const saved = await service.update(
    outletId,
    created.id,
    item({
      price: 38000,
      cost: null,
      tax: 'none',
      kitchenName: 'NasGor',
      description: 'Nasi goreng kampung dengan telur mata sapi.',
      imageUrl: 'https://cdn.example.com/nasgor.jpg',
      soldBy: 'weight',
      active: false,
    }),
  );
  expect(saved).toMatchObject({
    price: 38000,
    cost: null,
    tax: 'none',
    kitchenName: 'NasGor',
    description: 'Nasi goreng kampung dengan telur mata sapi.',
    imageUrl: 'https://cdn.example.com/nasgor.jpg',
    soldBy: 'weight',
    active: false,
  });
  expect((await service.items(outletId))[0]).toEqual(saved);
});

test('an item inherits its category’s station; its own station wins', async () => {
  const kitchen = await station('Dapur');
  const bar = await station('Bar');
  await categories.update(outletId, makananId, {
    name: 'Makanan',
    color: null,
    active: true,
    kitchenStationId: kitchen,
  });
  const inherited = await service.create(outletId, item());
  expect(inherited).toMatchObject({ kitchenStationId: null, stationId: kitchen });
  const own = await service.create(outletId, item({ name: 'Es Kopi', kitchenStationId: bar }));
  expect(own).toMatchObject({ kitchenStationId: bar, stationId: bar });
  // Name order within the category: Es Kopi, Nasi Goreng.
  expect((await service.items(outletId)).map((m) => m.stationId)).toEqual([bar, kitchen]);
});

test("an unknown, retired or another outlet's station is NOT_FOUND, and nothing is written", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const retired = await station('Grill', false);
  const theirs = await station('Bar', true, other);
  const notFound = { code: 'NOT_FOUND', message: 'Stasiun dapur tidak ditemukan.' };
  for (const kitchenStationId of [retired, theirs, '00000000-0000-0000-0000-000000000000'])
    await expect(service.create(outletId, item({ kitchenStationId }))).rejects.toMatchObject(notFound);
  expect(await service.items(outletId)).toEqual([]);
});

test('setActive flips only the on/off switch', async () => {
  const created = await service.create(outletId, item());
  expect(await service.setActive(outletId, created.id, false)).toEqual({ id: created.id, active: false });
  expect(await service.items(outletId)).toEqual([{ ...created, active: false }]);
});

test('a deleted item is NOT_FOUND for update, setActive and delete; a deleted category cannot be used', async () => {
  const created = await service.create(outletId, item());
  await service.delete(outletId, created.id);
  const notFound = { code: 'NOT_FOUND', message: 'Menu tidak ditemukan.' };
  await expect(service.update(outletId, created.id, item())).rejects.toMatchObject(notFound);
  await expect(service.setActive(outletId, created.id, false)).rejects.toMatchObject(notFound);
  await expect(service.delete(outletId, created.id)).rejects.toMatchObject(notFound);

  const gone = (await categories.create(outletId, 'Sementara')).id;
  await categories.delete(outletId, gone);
  await expect(service.create(outletId, item({ name: 'Lain', categoryId: gone }))).rejects.toMatchObject({
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
  expect(await service.items(outletId)).toEqual([]);
  const [row] = await db.select().from(menuItems).where(eq(menuItems.id, created.id));
  expect(row?.deletedAt).toBeInstanceOf(Date);
  await service.create(outletId, item());
});

test('a category whose items are all deleted can be deleted', async () => {
  const created = await service.create(outletId, item());
  await service.delete(outletId, created.id);
  await expect(categories.delete(outletId, makananId)).resolves.toEqual({ success: true });
});

test('taxRates reads both rates from the outlet', async () => {
  expect(await service.taxRates(outletId)).toEqual({ pbjtRateBp: 1000, ppnRateBp: 1100 });
  await db.update(outletRows).set({ ppnRateBp: 1200 }).where(eq(outletRows.id, outletId));
  expect(await service.taxRates(outletId)).toEqual({ pbjtRateBp: 1000, ppnRateBp: 1200 });
});

test('code is stored uppercase and unique among live items; blank is none; delete frees it', async () => {
  const first = await service.create(outletId, item({ code: ' ng-01 ' }));
  expect(first.code).toBe('NG-01');
  await expect(service.create(outletId, item({ name: 'Mie Goreng', code: 'ng-01' }))).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Kode menu sudah dipakai.',
  });
  // Any number of items may have no code.
  await service.create(outletId, item({ name: 'Mie Goreng', code: null }));
  expect((await service.create(outletId, item({ name: 'Mie Rebus', code: '  ' }))).code).toBeNull();
  await service.delete(outletId, first.id);
  await service.create(outletId, item({ name: 'Nasi Goreng Baru', code: 'NG-01' }));
});

test('with variants the item price is the lowest and its cost is null', async () => {
  const created = await service.create(
    outletId,
    item({
      price: 1,
      cost: 5000,
      variants: [
        { name: 'Large', price: 30000, cost: 11000, available: true },
        { name: 'Regular', price: 25000, cost: 9000, available: true },
      ],
    }),
  );
  expect(created).toMatchObject({ price: 25000, cost: null });
  expect(created.variants.map((v) => v.name)).toEqual(['Large', 'Regular']);
  expect(await service.items(outletId)).toEqual([created]);
});

test('a variant edit keeps ids, inserts new rows and soft-deletes the ones left out', async () => {
  const created = await service.create(
    outletId,
    item({
      variants: [
        { name: 'Large', price: 30000, cost: null, available: true },
        { name: 'Regular', price: 25000, cost: null, available: true },
      ],
    }),
  );
  const [large, regular] = created.variants;
  const saved = await service.update(
    outletId,
    created.id,
    item({
      variants: [
        { ...regular!, price: 26000 },
        { name: 'Jumbo', price: 40000, cost: null, available: false },
      ],
    }),
  );
  expect(saved.price).toBe(26000);
  expect(saved.variants).toMatchObject([
    { id: regular!.id, name: 'Regular', price: 26000 },
    { name: 'Jumbo', available: false },
  ]);
  const [row] = await db.select().from(menuVariants).where(eq(menuVariants.id, large!.id));
  expect(row?.deletedAt).toBeInstanceOf(Date);

  // Dropping every variant hands the price back to the item.
  const plain = await service.update(outletId, created.id, item({ price: 20000 }));
  expect(plain).toMatchObject({ price: 20000, cost: 12000, variants: [] });
});

test('a repeated variant name is BAD_REQUEST; a variant id from another item is NOT_FOUND', async () => {
  await expect(
    service.create(
      outletId,
      item({
        variants: [
          { name: 'Large', price: 1, cost: null, available: true },
          { name: 'large', price: 2, cost: null, available: true },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Nama varian "large" dipakai dua kali.' });

  const other = await service.create(
    outletId,
    item({ name: 'Es Teh', variants: [{ name: 'Large', price: 1, cost: null, available: true }] }),
  );
  const mine = await service.create(outletId, item());
  await expect(
    service.update(outletId, mine.id, item({ variants: [{ ...other.variants[0]! }] })),
  ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Varian tidak ditemukan.' });
});

test('add-on links keep the order sent, drop repeats, and are replaced on edit', async () => {
  const pedas = await addons.create(outletId, group('Level Pedas'));
  const topping = await addons.create(outletId, group('Topping'));
  const created = await service.create(outletId, item({ addonGroupIds: [topping.id, pedas.id, topping.id] }));
  expect(created.addonGroupIds).toEqual([topping.id, pedas.id]);
  expect((await addons.list(outletId)).map((g) => g.usedBy)).toEqual([1, 1]);
  expect((await service.list(outletId)).addonGroups.map((g) => g.name)).toEqual(['Level Pedas', 'Topping']);

  const saved = await service.update(outletId, created.id, item({ addonGroupIds: [pedas.id] }));
  expect(saved.addonGroupIds).toEqual([pedas.id]);
});

test("a deleted or another outlet's add-on group is NOT_FOUND", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' })).id;
  const theirs = await addons.create(other, group('Level Pedas'));
  const gone = await addons.create(outletId, group('Topping'));
  await addons.delete(outletId, gone.id);
  for (const id of [theirs.id, gone.id])
    await expect(service.create(outletId, item({ addonGroupIds: [id] }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Add-on tidak ditemukan.',
    });
});

test('deleting a group unlinks it; a deleted item no longer counts toward usedBy', async () => {
  const pedas = await addons.create(outletId, group('Level Pedas'));
  const a = await service.create(outletId, item({ addonGroupIds: [pedas.id] }));
  await service.create(outletId, item({ name: 'Mie Goreng', addonGroupIds: [pedas.id] }));
  await service.delete(outletId, a.id);
  expect((await addons.list(outletId))[0]?.usedBy).toBe(1);

  await addons.delete(outletId, pedas.id);
  expect((await service.items(outletId)).map((m) => m.addonGroupIds)).toEqual([[]]);
});

test('a rename chain in one save works: Regular→Large and Large→Jumbo', async () => {
  const created = await service.create(
    outletId,
    item({
      variants: [
        { name: 'Regular', price: 20000, cost: null, available: true },
        { name: 'Large', price: 25000, cost: null, available: true },
      ],
    }),
  );
  const [regular, large] = created.variants;
  const saved = await service.update(
    outletId,
    created.id,
    item({
      variants: [
        { ...regular!, name: 'Large' },
        { ...large!, name: 'Jumbo' },
      ],
    }),
  );
  expect(saved.variants).toMatchObject([
    { id: regular!.id, name: 'Large' },
    { id: large!.id, name: 'Jumbo' },
  ]);
});

test('one variant id sent twice is BAD_REQUEST, and nothing is written', async () => {
  const created = await service.create(
    outletId,
    item({ variants: [{ name: 'Regular', price: 20000, cost: null, available: true }] }),
  );
  const [regular] = created.variants;
  await expect(
    service.update(
      outletId,
      created.id,
      item({ variants: [{ ...regular! }, { ...regular!, name: 'Large' }] }),
    ),
  ).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Varian terkirim dua kali. Muat ulang lalu simpan lagi.',
  });
  expect((await service.items(outletId))[0]?.variants).toMatchObject([{ id: regular!.id, name: 'Regular' }]);
});

test('category list counts each category’s live menu items', async () => {
  const minuman = (await categories.create(outletId, 'Minuman')).id;
  await service.create(outletId, item({ name: 'Nasi Goreng' }));
  const mie = await service.create(outletId, item({ name: 'Mie Goreng' }));
  await service.create(outletId, item({ name: 'Ayam Geprek' }));
  await service.delete(outletId, mie.id);
  expect((await categories.list(outletId)).map((c) => [c.id, c.itemCount])).toEqual([
    [makananId, 2],
    [minuman, 0],
  ]);
});
