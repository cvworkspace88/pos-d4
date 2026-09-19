import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { outletStaff, outlets, permissions, roles, userPermissions, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { RbacService } from './rbac.service';

let db: TestDatabase;
let close: () => Promise<void>;
let rbac: RbacService;
let roleId: Record<string, string>;
let permissionId: (name: string) => Promise<string>;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  // Roles and permissions are seed data and survive truncateAll; seeding is idempotent.
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  permissionId = async (name) =>
    (await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.name, name)))[0]!.id;
  rbac = new RbacService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const addUser = async (username: string, globalRole: string | null = null) => {
  const [row] = await db
    .insert(users)
    .values({
      username,
      name: username,
      passwordHash: 'not-a-real-hash',
      roleId: globalRole ? roleId[globalRole] : null,
    })
    .returning();
  return row!;
};

const addOutlet = async (code: string) => {
  const [row] = await db.insert(outlets).values({ name: code, code }).returning();
  return row!;
};

const assign = (userId: string, outletId: string, role: string) =>
  db.insert(outletStaff).values({ userId, outletId, roleId: roleId[role]! });

test('a global role holds its permissions at any outlet, and with no outlet at all', async () => {
  const owner = await addUser('owner', 'owner');
  const o1 = await addOutlet('O1');

  expect(await rbac.permissionsOf(owner.id, o1.id)).toContain('outlet.manage');
  expect(await rbac.permissionsOf(owner.id, null)).toContain('outlet.manage');
});

test('a scoped user holds the role of the active outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');
  await assign(ann.id, o2.id, 'manager');

  expect(await rbac.permissionsOf(ann.id, o1.id)).not.toContain('table.create');
  expect(await rbac.permissionsOf(ann.id, o2.id)).toContain('table.create');
});

test('the wrong outlet, or none, gives a scoped user no role permissions', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');

  expect(await rbac.permissionsOf(ann.id, o2.id)).toEqual([]);
  expect(await rbac.permissionsOf(ann.id, null)).toEqual([]);
});

test('per-user grants are global: they survive a null outlet', async () => {
  const ann = await addUser('ann');
  await db
    .insert(userPermissions)
    .values({ userId: ann.id, permissionId: await permissionId('table.view'), effect: 'grant' });

  expect(await rbac.permissionsOf(ann.id, null)).toEqual(['table.view']);
});

test('a revoke still takes back what the outlet role gives', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await assign(ann.id, o1.id, 'cashier');
  await db
    .insert(userPermissions)
    .values({ userId: ann.id, permissionId: await permissionId('sales.create'), effect: 'revoke' });

  const held = await rbac.permissionsOf(ann.id, o1.id);
  expect(held).toContain('sales.view');
  expect(held).not.toContain('sales.create');
});

test('a closed outlet grants nothing, even before the session is reissued', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await assign(ann.id, o1.id, 'cashier');
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, o1.id));

  expect(await rbac.permissionsOf(ann.id, o1.id)).toEqual([]);
});

test('require is FORBIDDEN, never UNAUTHORIZED', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await assign(ann.id, o1.id, 'cashier');
  const actor = { user: { id: ann.id }, outletId: o1.id, global: false };

  await expect(rbac.require(actor, 'sales.create')).resolves.toBeUndefined();
  await expect(rbac.require(actor, 'outlet.manage')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Requires outlet.manage.',
  });
});
