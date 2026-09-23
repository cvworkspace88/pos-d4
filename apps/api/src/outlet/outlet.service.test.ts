import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { roles, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { OutletService } from './outlet.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: OutletService;
let roleId: Record<string, string>;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  // The service only ever needs the database handle; Nest's DI is not in the picture.
  service = new OutletService(db);
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
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

const OWNER = { global: true };
const STAFF = { global: false };

const as = (userId: string, role = 'cashier') => ({ userId, roleId: roleId[role]! });

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
    message: 'Nama outlet sudah dipakai.',
  });
});

test('a duplicate live code is a CONFLICT naming the code, whatever the casing', async () => {
  await anOutlet('Downtown', 'dt');
  await expect(service.create({ name: 'Elsewhere', code: 'DT' })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Kode outlet sudah dipakai.',
  });
});

test('closing an outlet frees its name and its code', async () => {
  const outlet = await anOutlet('Airport', 'ap');
  await anOutlet('Keeper', 'kp'); // keeps one outlet live so the last-outlet guard does not fire
  await service.setActive(outlet.id, false);
  const reopened = await service.create({ name: 'Airport', code: 'ap' });
  expect(reopened.id).not.toBe(outlet.id);
});

test('list shows every outlet, active first, then by name', async () => {
  await anOutlet('Downtown', 'dt');
  await anOutlet('Airport', 'ap');
  const closed = await anOutlet('Warehouse', 'wh');
  await service.setActive(closed.id, false);

  const listed = await service.list();
  expect(listed.map((o) => o.name)).toEqual(['Airport', 'Downtown', 'Warehouse']);
  expect(listed.map((o) => o.active)).toEqual([true, true, false]);
});

test('get returns one outlet, and a closed one is NOT_FOUND', async () => {
  const outlet = await service.create({ name: 'Downtown', code: 'dt', phone: '555' });
  expect(await service.get(outlet.id)).toMatchObject({ name: 'Downtown', code: 'DT', phone: '555' });
  await anOutlet('Keeper', 'kp'); // keeps one outlet live so the last-outlet guard does not fire
  await service.setActive(outlet.id, false);
  await expect(service.get(outlet.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('update is a form save: an omitted address clears the column', async () => {
  const outlet = await service.create({ name: 'Downtown', code: 'dt', address: '1 Main St' });
  const saved = await service.update(outlet.id, { name: 'Downtown' });
  expect(saved.address).toBeNull();
});

test('update leaves the code alone — only setCode writes it', async () => {
  const outlet = await anOutlet();
  const saved = await service.update(outlet.id, { name: 'Uptown' });
  expect(saved).toMatchObject({ name: 'Uptown', code: 'DT' });
});

test('setCode stores uppercase, same as create', async () => {
  const outlet = await anOutlet();
  expect((await service.setCode(outlet.id, 'br2')).code).toBe('BR2');
});

test('setCode onto a live code is a CONFLICT naming the code', async () => {
  const outlet = await anOutlet();
  await service.create({ name: 'Airport', code: 'ap' });
  await expect(service.setCode(outlet.id, 'AP')).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Kode outlet sudah dipakai.',
  });
});

test('setCode on a closed outlet is NOT_FOUND', async () => {
  const outlet = await anOutlet();
  await anOutlet('Keeper', 'kp'); // keeps one outlet live so the last-outlet guard does not fire
  await service.setActive(outlet.id, false);
  await expect(service.setCode(outlet.id, 'br2')).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Outlet tidak ditemukan.',
  });
});

test('update of a closed outlet is NOT_FOUND, not a silent no-op', async () => {
  const outlet = await anOutlet();
  await anOutlet('Keeper', 'kp'); // keeps one outlet live so the last-outlet guard does not fire
  await service.setActive(outlet.id, false);
  await expect(service.update(outlet.id, { name: 'Downtown' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Outlet tidak ditemukan.',
  });
});

test('deactivating an outlet twice is a no-op the second time', async () => {
  const outlet = await anOutlet();
  await anOutlet('Airport', 'ap'); // the guard needs a second live outlet to allow the first close
  expect((await service.setActive(outlet.id, false)).active).toBe(false);
  expect((await service.setActive(outlet.id, false)).active).toBe(false);
});

test('setStaff writes the roster and reads it back sorted by name', async () => {
  const outlet = await anOutlet();
  const zoe = await addUser('zoe');
  const ann = await addUser('ann');

  const roster = await service.setStaff(outlet.id, [as(zoe.id), as(ann.id)], OWNER);
  expect(roster.map((s) => s.username)).toEqual(['ann', 'zoe']);
});

test('setStaff twice with the same ids changes nothing the second time', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');

  const first = await service.setStaff(outlet.id, [as(ann.id)], OWNER);
  const second = await service.setStaff(outlet.id, [as(ann.id)], OWNER);
  expect(second).toEqual(first);
});

test('a duplicate id in the input is assigned once', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  expect(await service.setStaff(outlet.id, [as(ann.id), as(ann.id)], OWNER)).toHaveLength(1);
});

test('an empty list clears the roster and leaves the outlet alone', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await service.setStaff(outlet.id, [as(ann.id)], OWNER);

  expect(await service.setStaff(outlet.id, [], OWNER)).toEqual([]);
  expect(await service.staff(outlet.id)).toEqual([]);
});

test('an unknown user rejects the whole call and rolls the roster back', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  await service.setStaff(outlet.id, [as(ann.id)], OWNER);

  const ghost = '00000000-0000-0000-0000-000000000000';
  await expect(service.setStaff(outlet.id, [as(bob.id), as(ghost)], OWNER)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: `Not a valid user: ${ghost}.`,
  });
  // Bob was in the same batch as the ghost, so he must not have landed, and Ann must still be here.
  expect((await service.staff(outlet.id)).map((s) => s.username)).toEqual(['ann']);
});

test('a soft-deleted user cannot be assigned', async () => {
  const outlet = await anOutlet();
  const gone = await addUser('gone', new Date());
  await expect(service.setStaff(outlet.id, [as(gone.id)], OWNER)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

test('a staff member who leaves drops out of the roster without being unassigned', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  await service.setStaff(outlet.id, [as(ann.id), as(bob.id)], OWNER);

  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, bob.id));
  expect((await service.staff(outlet.id)).map((s) => s.username)).toEqual(['ann']);
});

test('setStaff on a closed outlet is NOT_FOUND', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await anOutlet('Keeper', 'kp'); // keeps one outlet live so the last-outlet guard does not fire
  await service.setActive(outlet.id, false);
  await expect(service.setStaff(outlet.id, [as(ann.id)], OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('staff on an outlet that never existed is NOT_FOUND', async () => {
  await expect(service.staff('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('the roster reports each member role', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const roster = await service.setStaff(outlet.id, [as(ann.id, 'manager')], OWNER);
  expect(roster[0]?.roleId).toBe(roleId.manager);
  expect(roster[0]?.roleName).toBe('manager');
});

test('assignable roles leave out owner', async () => {
  const names = (await service.assignableRoles(OWNER)).map((r) => r.name);
  expect(names).toContain('manager');
  expect(names).not.toContain('owner');
});

test('changing a member role replaces the row', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await service.setStaff(outlet.id, [as(ann.id, 'cashier')], OWNER);
  const roster = await service.setStaff(outlet.id, [as(ann.id, 'manager')], OWNER);
  expect(roster).toHaveLength(1);
  expect(roster[0]?.roleId).toBe(roleId.manager);
});

test('the owner role never goes on a roster', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await expect(service.setStaff(outlet.id, [as(ann.id, 'owner')], OWNER)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Owner is global.',
  });
});

test('an owner-level user never goes on a roster, whatever the role', async () => {
  const outlet = await anOutlet();
  const [boss] = await db
    .insert(users)
    .values({ username: 'boss', name: 'BOSS', passwordHash: 'not-a-real-hash', roleId: roleId.owner })
    .returning();
  await expect(service.setStaff(outlet.id, [as(boss!.id, 'cashier')], STAFF)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Owner is global.',
  });
});

test('an unknown role rejects the whole call', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const ghost = '00000000-0000-0000-0000-000000000000';
  await expect(service.setStaff(outlet.id, [{ userId: ann.id, roleId: ghost }], OWNER)).rejects.toMatchObject(
    {
      code: 'BAD_REQUEST',
      message: `Not a valid role: ${ghost}.`,
    },
  );
});

test('a fresh outlet is active', async () => {
  expect((await anOutlet()).active).toBe(true);
});

test('reactivating a closed outlet brings back the same row', async () => {
  const outlet = await anOutlet();
  await anOutlet('Airport', 'ap');
  await service.setActive(outlet.id, false);

  const reopened = await service.setActive(outlet.id, true);
  expect(reopened).toMatchObject({ id: outlet.id, name: 'Downtown', code: 'DT', active: true });
  expect((await service.get(outlet.id)).active).toBe(true);
});

test('reactivating into a name another outlet took is a CONFLICT', async () => {
  const outlet = await anOutlet('Downtown', 'dt');
  await anOutlet('Airport', 'ap');
  await service.setActive(outlet.id, false);
  await service.create({ name: 'Downtown', code: 'dt2' });

  await expect(service.setActive(outlet.id, true)).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama outlet sudah dipakai.',
  });
});

test('reactivating into a code another outlet took is a CONFLICT', async () => {
  const outlet = await anOutlet('Downtown', 'dt');
  await anOutlet('Airport', 'ap');
  await service.setActive(outlet.id, false);
  await service.create({ name: 'Elsewhere', code: 'dt' });

  await expect(service.setActive(outlet.id, true)).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Kode outlet sudah dipakai.',
  });
});

test('the last live outlet cannot be deactivated', async () => {
  const outlet = await anOutlet();
  await expect(service.setActive(outlet.id, false)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Harus ada minimal satu outlet aktif.',
  });
  expect((await service.get(outlet.id)).active).toBe(true);
});

test('the guard counts only live outlets, so a closed one does not license closing the last', async () => {
  const first = await anOutlet('Downtown', 'dt');
  const second = await anOutlet('Airport', 'ap');
  await service.setActive(second.id, false);

  await expect(service.setActive(first.id, false)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
});

test('setActive on an outlet that never existed is NOT_FOUND in both directions', async () => {
  const ghost = '00000000-0000-0000-0000-000000000000';
  await expect(service.setActive(ghost, false)).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Outlet tidak ditemukan.',
  });
  await expect(service.setActive(ghost, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('the roster lists global-role users first, flagged, without a membership', async () => {
  const outlet = await anOutlet();
  await db.insert(users).values({ username: 'boss', name: 'Boss', passwordHash: 'x', roleId: roleId.owner });
  const ann = await addUser('ann');
  const roster = await service.setStaff(outlet.id, [as(ann.id)], OWNER);
  expect(roster.map((s) => [s.username, s.roleName, s.global])).toEqual([
    ['boss', 'owner', true],
    ['ann', 'cashier', false],
  ]);
});

test('a non-owner cannot remove, demote or appoint a manager', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  await service.setStaff(outlet.id, [as(ann.id, 'manager'), as(bob.id)], OWNER);
  const refused = { code: 'FORBIDDEN', message: 'Hanya owner yang bisa mengatur manajer.' };

  await expect(service.setStaff(outlet.id, [as(bob.id)], STAFF)).rejects.toMatchObject(refused);
  await expect(service.setStaff(outlet.id, [as(ann.id), as(bob.id)], STAFF)).rejects.toMatchObject(refused);
  await expect(
    service.setStaff(outlet.id, [as(ann.id, 'manager'), as(bob.id, 'manager')], STAFF),
  ).rejects.toMatchObject(refused);
});

test('a non-owner manages everyone below manager, leaving managers untouched', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const bob = await addUser('bob');
  const cy = await addUser('cy');
  await service.setStaff(outlet.id, [as(ann.id, 'manager'), as(bob.id)], OWNER);
  const roster = await service.setStaff(outlet.id, [as(ann.id, 'manager'), as(cy.id, 'waiter')], STAFF);
  expect(roster.map((s) => [s.username, s.roleName])).toEqual([
    ['ann', 'manager'],
    ['cy', 'waiter'],
  ]);
});

test('manager is assignable only for a global role', async () => {
  expect((await service.assignableRoles(STAFF)).map((r) => r.name)).not.toContain('manager');
  expect((await service.assignableRoles(OWNER)).map((r) => r.name)).toContain('manager');
});
