import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { addonOptions } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import type { Actor } from '../auth/rbac-rules';
import { connectTestDatabase, truncateAll, type TestDatabase, testActor } from '../test/test-db';
import { AddonService, type AddonGroupInput } from './addon.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: AddonService;
let outlets: OutletService;
let outletId: string;
let ACTOR: Actor;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new AddonService(db);
  outlets = new OutletService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  ACTOR = await testActor(db);
  outletId = (await outlets.create({ name: 'Downtown', code: 'DT' }, ACTOR)).id;
});

const group = (over: Partial<AddonGroupInput> = {}): AddonGroupInput => ({
  name: 'Level Pedas',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { name: 'Tidak pedas', price: 0, available: true },
    { name: 'Pedas', price: 2000, available: true },
  ],
  ...over,
});

test('create returns the group with its options in order and usedBy 0; list shows it', async () => {
  const created = await service.create(ACTOR, outletId, group());
  expect(created).toMatchObject({ name: 'Level Pedas', minSelect: 1, maxSelect: 1, usedBy: 0 });
  expect(created.options.map((o) => [o.name, o.price])).toEqual([
    ['Tidak pedas', 0],
    ['Pedas', 2000],
  ]);
  expect(await service.list(outletId)).toEqual([created]);
});

test('a duplicate live group name at the same outlet is a CONFLICT', async () => {
  await service.create(ACTOR, outletId, group());
  await expect(service.create(ACTOR, outletId, group())).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama add-on sudah dipakai.',
  });
});

test('update keeps option ids, inserts new ones and soft-deletes the ones left out', async () => {
  const created = await service.create(ACTOR, outletId, group());
  const [tidak, pedas] = created.options;
  const saved = await service.update(
    ACTOR,
    outletId,
    created.id,
    group({
      minSelect: 0,
      maxSelect: 2,
      options: [
        { ...pedas!, price: 3000 },
        { name: 'Extra pedas', price: 4000, available: false },
      ],
    }),
  );
  expect(saved).toMatchObject({ minSelect: 0, maxSelect: 2 });
  expect(saved.options).toMatchObject([
    { id: pedas!.id, name: 'Pedas', price: 3000 },
    { name: 'Extra pedas', available: false },
  ]);
  const [row] = await db.select().from(addonOptions).where(eq(addonOptions.id, tidak!.id));
  expect(row?.deletedAt).toBeInstanceOf(Date);
});

test('a bad pick rule or a repeated option name is BAD_REQUEST', async () => {
  await expect(service.create(ACTOR, outletId, group({ minSelect: 3, maxSelect: 3 }))).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Pilihan minimum melebihi jumlah pilihan (2).',
  });
  await expect(
    service.create(
      ACTOR,
      outletId,
      group({
        options: [
          { name: 'Pedas', price: 0, available: true },
          { name: 'pedas', price: 0, available: true },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Nama pilihan "pedas" dipakai dua kali.' });
});

test("another outlet's group is NOT_FOUND, and so is an option id from another group", async () => {
  const other = (await outlets.create({ name: 'Uptown', code: 'UP' }, ACTOR)).id;
  const theirs = await service.create(ACTOR, other, group());
  expect(await service.list(outletId)).toEqual([]);
  await expect(service.update(ACTOR, outletId, theirs.id, group())).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Add-on tidak ditemukan.',
  });
  await expect(service.delete(ACTOR, outletId, theirs.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

  const mine = await service.create(ACTOR, outletId, group());
  await expect(
    service.update(ACTOR, outletId, mine.id, group({ options: [{ ...theirs.options[0]! }] })),
  ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Pilihan tidak ditemukan.' });
});

test('delete is soft and frees the name', async () => {
  const created = await service.create(ACTOR, outletId, group());
  await service.delete(ACTOR, outletId, created.id);
  expect(await service.list(outletId)).toEqual([]);
  await service.create(ACTOR, outletId, group());
});

test('an option rename chain in one save works: Pedas→Sedang and Sedang→Ringan', async () => {
  const created = await service.create(
    ACTOR,
    outletId,
    group({
      options: [
        { name: 'Pedas', price: 0, available: true },
        { name: 'Sedang', price: 0, available: true },
      ],
    }),
  );
  const [pedas, sedang] = created.options;
  const saved = await service.update(
    ACTOR,
    outletId,
    created.id,
    group({
      options: [
        { ...pedas!, name: 'Sedang' },
        { ...sedang!, name: 'Ringan' },
      ],
    }),
  );
  expect(saved.options.map((o) => [o.id, o.name])).toEqual([
    [pedas!.id, 'Sedang'],
    [sedang!.id, 'Ringan'],
  ]);
});

test('one option id sent twice is BAD_REQUEST', async () => {
  const created = await service.create(ACTOR, outletId, group());
  const [tidak] = created.options;
  await expect(
    service.update(
      ACTOR,
      outletId,
      created.id,
      group({ options: [{ ...tidak! }, { ...tidak!, name: 'Lain' }] }),
    ),
  ).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Pilihan terkirim dua kali. Muat ulang lalu simpan lagi.',
  });
});
