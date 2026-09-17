import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { OutletService } from './outlet.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: OutletService;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  // The service only ever needs the database handle; Nest's DI is not in the picture.
  service = new OutletService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** Staff need no role or PIN for any of this — only a live row in `users`. */
const addUser = async (username: string, deletedAt: Date | null = null) => {
  const [row] = await db
    .insert(users)
    .values({ username, name: username.toUpperCase(), passwordHash: 'not-a-real-hash', deletedAt })
    .returning();
  return row!;
};

const anOutlet = (name = 'Downtown', code = 'dt') => service.create({ name, code });

test('a code is stored uppercase, so the unique index catches br2 against BR2', async () => {
  const outlet = await anOutlet('Branch Two', ' br2 ');
  expect(outlet.code).toBe('BR2');
});

test('address and phone default to null rather than undefined', async () => {
  const outlet = await anOutlet();
  expect(outlet.address).toBeNull();
  expect(outlet.phone).toBeNull();
});

test('a duplicate live name is a CONFLICT naming the name', async () => {
  await anOutlet('Downtown', 'dt');
  await expect(service.create({ name: 'Downtown', code: 'xx' })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Outlet name already in use.',
  });
});

test('a duplicate live code is a CONFLICT naming the code, whatever the casing', async () => {
  await anOutlet('Downtown', 'dt');
  await expect(service.create({ name: 'Elsewhere', code: 'DT' })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Outlet code already in use.',
  });
});

test('closing an outlet frees its name and its code', async () => {
  const outlet = await anOutlet('Airport', 'ap');
  await service.remove(outlet.id);
  const reopened = await service.create({ name: 'Airport', code: 'ap' });
  expect(reopened.id).not.toBe(outlet.id);
});

test('list hides closed outlets and sorts by name', async () => {
  await anOutlet('Downtown', 'dt');
  await anOutlet('Airport', 'ap');
  const closed = await anOutlet('Warehouse', 'wh');
  await service.remove(closed.id);

  expect((await service.list()).map((o) => o.name)).toEqual(['Airport', 'Downtown']);
});

test('update is a form save: an omitted address clears the column', async () => {
  const outlet = await service.create({ name: 'Downtown', code: 'dt', address: '1 Main St' });
  const saved = await service.update(outlet.id, { name: 'Downtown', code: 'dt' });
  expect(saved.address).toBeNull();
});

test('update of a closed outlet is NOT_FOUND, not a silent no-op', async () => {
  const outlet = await anOutlet();
  await service.remove(outlet.id);
  await expect(service.update(outlet.id, { name: 'Downtown', code: 'dt' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Outlet not found.',
  });
});

test('closing an outlet twice is NOT_FOUND the second time', async () => {
  const outlet = await anOutlet();
  expect(await service.remove(outlet.id)).toEqual({ success: true });
  await expect(service.remove(outlet.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('setStaff writes the roster and reads it back sorted by name', async () => {
  const outlet = await anOutlet();
  const zoe = await addUser('zoe');
  const ann = await addUser('ann');

  const roster = await service.setStaff(outlet.id, [zoe.id, ann.id]);
  expect(roster.map((s) => s.username)).toEqual(['ann', 'zoe']);
});

test('setStaff twice with the same ids changes nothing the second time', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');

  const first = await service.setStaff(outlet.id, [ann.id]);
  const second = await service.setStaff(outlet.id, [ann.id]);
  expect(second).toEqual(first);
});

test('a duplicate id in the input is assigned once', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  expect(await service.setStaff(outlet.id, [ann.id, ann.id])).toHaveLength(1);
});

test('an empty list clears the roster and leaves the outlet alone', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await service.setStaff(outlet.id, [ann.id]);

  expect(await service.setStaff(outlet.id, [])).toEqual([]);
  expect(await service.staff(outlet.id)).toEqual([]);
});

test('an unknown user rejects the whole call and rolls the roster back', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  await service.setStaff(outlet.id, [ann.id]);

  const ghost = '00000000-0000-0000-0000-000000000000';
  await expect(service.setStaff(outlet.id, [bob.id, ghost])).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: `Not a valid user: ${ghost}.`,
  });
  // Bob was in the same batch as the ghost, so he must not have landed, and Ann must still be here.
  expect((await service.staff(outlet.id)).map((s) => s.username)).toEqual(['ann']);
});

test('a soft-deleted user cannot be assigned', async () => {
  const outlet = await anOutlet();
  const gone = await addUser('gone', new Date());
  await expect(service.setStaff(outlet.id, [gone.id])).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

test('a staff member who leaves drops out of the roster without being unassigned', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  await service.setStaff(outlet.id, [ann.id, bob.id]);

  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, bob.id));
  expect((await service.staff(outlet.id)).map((s) => s.username)).toEqual(['ann']);
});

test('setStaff on a closed outlet is NOT_FOUND', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await service.remove(outlet.id);
  await expect(service.setStaff(outlet.id, [ann.id])).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('staff on an outlet that never existed is NOT_FOUND', async () => {
  await expect(service.staff('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
