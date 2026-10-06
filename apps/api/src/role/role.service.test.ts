import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from './seed-rbac';
import type { Actor } from '../auth/rbac-rules';
import { RbacService } from '../auth/rbac.service';
import { auditLog, outletStaff, outlets, roles, userPermissions, users } from '../db/schema';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { RoleService } from './role.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: RoleService;
let roleId: Record<string, string>;
let OWNER: Actor;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  service = new RoleService(db, new RbacService(db));
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  OWNER = await testActor(db, true);
});

const addUser = async (username: string, globalRole: string | null = null) => {
  const [row] = await db
    .insert(users)
    .values({ username, name: username, passwordHash: 'x', roleId: globalRole ? roleId[globalRole] : null })
    .returning();
  return row!;
};

const addOutlet = async (code: string) => {
  const [row] = await db.insert(outlets).values({ name: code, code }).returning();
  return row!;
};

const auditRows = () => db.select().from(auditLog).orderBy(auditLog.createdAt);

const spv = { name: 'Supervisor Malam', description: null, permissions: ['table.view', 'order.void_sent'] };

test('create stores the role editable, with its grants, and audits it', async () => {
  const { id } = await service.create(spv, OWNER);

  const [row] = await db.select().from(roles).where(eq(roles.id, id));
  expect(row).toMatchObject({ name: 'Supervisor Malam', editable: true, isGlobal: false });
  const matrix = await service.matrix();
  const col = matrix.roles.findIndex((r) => r.id === id);
  const held = matrix.groups.flatMap((g) => g.rows.filter((r) => r.granted[col]).map((r) => r.key));
  expect(held.sort()).toEqual(['order.void_sent', 'table.view']);

  const [entry] = await auditRows();
  expect(entry).toMatchObject({
    module: 'role',
    action: 'role.create',
    entityId: id,
    outletId: null,
    before: null,
  });
  expect(entry!.after).toEqual({
    name: 'Supervisor Malam',
    description: null,
    permissions: ['order.void_sent', 'table.view'],
  });
});

test('a duplicate name is a CONFLICT', async () => {
  await service.create(spv, OWNER);
  await expect(service.create(spv, OWNER)).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nama peran sudah dipakai.',
  });
  await expect(service.create({ ...spv, name: 'cashier' }, OWNER)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});

test('an unknown permission refuses the whole call', async () => {
  await expect(
    service.create({ ...spv, permissions: ['table.view', 'sales.void_request'] }, OWNER),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Izin tidak dikenal: sales.void_request.' });
  expect(await db.select().from(roles).where(eq(roles.name, 'Supervisor Malam'))).toEqual([]);
});

test('update replaces name and grants, audits only what changed, and an unchanged save writes nothing', async () => {
  const { id } = await service.create(spv, OWNER);
  await service.update(id, { ...spv, permissions: ['table.view'] }, OWNER);
  await service.update(id, { ...spv, permissions: ['table.view'] }, OWNER);

  const rows = await auditRows();
  expect(rows.map((r) => r.action)).toEqual(['role.create', 'role.update']);
  expect(rows[1]!.before).toEqual({ permissions: ['order.void_sent', 'table.view'] });
  expect(rows[1]!.after).toEqual({ permissions: ['table.view'] });
});

test('a base role cannot be updated or deleted', async () => {
  for (const name of ['owner', 'cashier']) {
    await expect(service.update(roleId[name]!, spv, OWNER)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Peran bawaan tidak bisa diubah.',
    });
    await expect(service.delete(roleId[name]!, OWNER)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
});

test('an unknown role is NOT_FOUND', async () => {
  const missing = '00000000-0000-4000-8000-000000000000';
  await expect(service.update(missing, spv, OWNER)).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Peran tidak ditemukan.',
  });
  await expect(service.delete(missing, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('a role held as a global role cannot be deleted', async () => {
  const { id } = await service.create(spv, OWNER);
  const ann = await addUser('ann');
  await db.update(users).set({ roleId: id }).where(eq(users.id, ann.id));

  await expect(service.delete(id, OWNER)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Peran masih dipakai staf.',
  });
  expect(await db.select().from(roles).where(eq(roles.id, id))).toHaveLength(1);
});

test('a role still assigned cannot be deleted; an unused one can, and is audited', async () => {
  const { id } = await service.create(spv, OWNER);
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await db.insert(outletStaff).values({ outletId: o1.id, userId: ann.id, roleId: id });

  await expect(service.delete(id, OWNER)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Peran masih dipakai staf.',
  });

  await db.delete(outletStaff);
  await service.delete(id, OWNER);
  expect(await db.select().from(roles).where(eq(roles.id, id))).toEqual([]);
  const rows = await auditRows();
  expect(rows.at(-1)).toMatchObject({ action: 'role.delete', after: null });
  expect(rows.at(-1)!.before).toMatchObject({ name: 'Supervisor Malam' });
});

test('matrix says which roles are locked and which is global', async () => {
  const { id } = await service.create(spv, OWNER);
  const { roles: list } = await service.matrix();
  expect(list.find((r) => r.name === 'owner')).toMatchObject({ isGlobal: true, editable: false });
  expect(list.find((r) => r.name === 'cashier')).toMatchObject({ isGlobal: false, editable: false });
  expect(list.find((r) => r.id === id)).toMatchObject({ isGlobal: false, editable: true });
});

const member = async (userId: string, outletId: string, role = 'cashier') =>
  db.insert(outletStaff).values({ userId, outletId, roleId: roleId[role]! });

test('setOverride writes one row and one audit row per outlet, and the grant applies there only', async () => {
  const ann = await addUser('ann');
  const [o1, o2, o3] = [await addOutlet('O1'), await addOutlet('O2'), await addOutlet('O3')];
  for (const o of [o1, o2, o3]) await member(ann.id, o.id);

  await service.setOverride(
    { userId: ann.id, outletIds: [o1.id, o2.id], permission: 'menu.manage', effect: 'grant' },
    OWNER,
  );

  const rbac = new RbacService(db);
  expect(await rbac.permissionsOf(ann.id, o1.id)).toContain('menu.manage');
  expect(await rbac.permissionsOf(ann.id, o2.id)).toContain('menu.manage');
  expect(await rbac.permissionsOf(ann.id, o3.id)).not.toContain('menu.manage');

  const rows = await auditRows();
  expect(rows.map((r) => [r.action, r.outletId, r.entityId])).toEqual(
    expect.arrayContaining([
      ['role.override', o1.id, ann.id],
      ['role.override', o2.id, ann.id],
    ]),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]!.after).toEqual({ 'menu.manage': 'grant' });
});

test('setOverride revokes, a repeat writes no audit row, and null clears it', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await member(ann.id, o1.id);
  const set = (effect: 'grant' | 'revoke' | null) =>
    service.setOverride({ userId: ann.id, outletIds: [o1.id], permission: 'table.view', effect }, OWNER);

  await set('revoke');
  await set('revoke');
  expect((await service.userPermissions(ann.id, o1.id)).find((r) => r.permission === 'table.view')).toEqual({
    permission: 'table.view',
    fromRole: true,
    override: 'revoke',
    effective: false,
  });
  await set(null);
  expect(await db.select().from(userPermissions)).toEqual([]);

  const rows = await auditRows();
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ before: { 'table.view': 'revoke' }, after: null });
});

test('setOverride refuses a non-member, a global user and an unknown permission', async () => {
  const ann = await addUser('ann');
  const boss = await addUser('boss', 'owner');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await member(ann.id, o1.id);

  await expect(
    service.setOverride(
      { userId: ann.id, outletIds: [o1.id, o2.id], permission: 'menu.manage', effect: 'grant' },
      OWNER,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Staf tidak ditemukan.' });
  await expect(
    service.setOverride(
      { userId: boss.id, outletIds: [o1.id], permission: 'menu.manage', effect: 'revoke' },
      OWNER,
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Owner is global.' });
  await expect(
    service.setOverride(
      { userId: ann.id, outletIds: [o1.id], permission: 'sales.view', effect: 'grant' },
      OWNER,
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Izin tidak dikenal: sales.view.' });
  expect(await db.select().from(userPermissions)).toEqual([]);
});
