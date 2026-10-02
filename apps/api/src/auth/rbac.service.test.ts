import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { auditLog, outletStaff, outlets, permissions, roles, userPermissions, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import type { Actor } from './rbac-rules';
import { RbacService } from './rbac.service';

let db: TestDatabase;
let close: () => Promise<void>;
let rbac: RbacService;
let roleId: Record<string, string>;
let permissionId: (name: string) => Promise<string>;
let pinHash: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  // Roles and permissions are seed data and survive truncateAll; seeding is idempotent.
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  permissionId = async (name) =>
    (await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.name, name)))[0]!.id;
  rbac = new RbacService(db);
  pinHash = await argon2.hash(PIN);
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

test('an override applies at its own outlet only, and never without an outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');
  await assign(ann.id, o2.id, 'cashier');
  await db.insert(userPermissions).values({
    userId: ann.id,
    outletId: o1.id,
    permissionId: await permissionId('table.create'),
    effect: 'grant',
  });

  expect(await rbac.permissionsOf(ann.id, o1.id)).toContain('table.create');
  expect(await rbac.permissionsOf(ann.id, o2.id)).not.toContain('table.create');
  expect(await rbac.permissionsOf(ann.id, null)).toEqual([]);
});

test('a revoke takes back what the role gives, at that outlet only', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');
  await assign(ann.id, o2.id, 'cashier');
  await db.insert(userPermissions).values({
    userId: ann.id,
    outletId: o1.id,
    permissionId: await permissionId('table.view'),
    effect: 'revoke',
  });

  const atO1 = await rbac.permissionsOf(ann.id, o1.id);
  expect(atO1).toContain('reservation.view');
  expect(atO1).not.toContain('table.view');
  expect(await rbac.permissionsOf(ann.id, o2.id)).toContain('table.view');
});

test('an override needs a live membership at its outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await db.insert(userPermissions).values({
    userId: ann.id,
    outletId: o1.id,
    permissionId: await permissionId('table.create'),
    effect: 'grant',
  });

  // Not a member: a stale grant from before a removal must not reopen the outlet.
  expect(await rbac.permissionsOf(ann.id, o1.id)).toEqual([]);

  await assign(ann.id, o1.id, 'cashier');
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, o1.id));
  expect(await rbac.permissionsOf(ann.id, o1.id)).toEqual([]);
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

  await expect(rbac.require(actor, 'table.view')).resolves.toBeUndefined();
  await expect(rbac.require(actor, 'outlet.manage')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Anda tidak memiliki akses.',
  });
});

const PIN = '654321';

const withPin = (userId: string) => db.update(users).set({ pinHash }).where(eq(users.id, userId));

/** A kitchen user (no `table.merge`) at O1, and a manager there with a PIN. */
const approvalSetup = async () => {
  const o1 = await addOutlet('O1');
  const kim = await addUser('kim');
  await assign(kim.id, o1.id, 'kitchen');
  const max = await addUser('max');
  await assign(max.id, o1.id, 'manager');
  await withPin(max.id);
  const actor = { user: { id: kim.id }, outletId: o1.id, global: false };
  return { o1, kim, max, actor };
};

test('requireOrApprove lets a holder through and ignores any approval sent', async () => {
  const { o1, max } = await approvalSetup();
  const self = { user: { id: max.id }, outletId: o1.id, global: false };
  expect(
    await rbac.requireOrApprove(self, 'table.merge', { approverUserId: max.id, pin: '000000' }),
  ).toBeNull();
});

test('requireOrApprove without an approval is FORBIDDEN with NEEDS_APPROVAL', async () => {
  const { actor } = await approvalSetup();
  await expect(rbac.requireOrApprove(actor, 'table.merge')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Anda tidak memiliki akses.',
    cause: { reason: 'NEEDS_APPROVAL' },
  });
});

test('a manager PIN approves the action, which stays the caller’s', async () => {
  const { actor, max } = await approvalSetup();
  expect(
    await rbac.requireOrApprove(actor, 'table.merge', { approverUserId: max.id, pin: PIN, reason: 'ramai' }),
  ).toEqual({ actor, permission: 'table.merge', approverUserId: max.id, reason: 'ramai' });
});

test('an approver without approval.grant cannot approve', async () => {
  const { o1, actor } = await approvalSetup();
  const wes = await addUser('wes');
  await assign(wes.id, o1.id, 'waiter'); // holds table.merge, not approval.grant
  await withPin(wes.id);
  await expect(
    rbac.requireOrApprove(actor, 'table.merge', { approverUserId: wes.id, pin: PIN }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Penyetuju tidak memiliki akses.' });
});

test('an approver without the permission itself cannot approve', async () => {
  const { actor, max } = await approvalSetup();
  // Managers hold approval.grant but not role.manage.
  await expect(
    rbac.requireOrApprove(actor, 'role.manage', { approverUserId: max.id, pin: PIN }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Penyetuju tidak memiliki akses.' });
});

test('a revoke override takes the approval right away', async () => {
  const { o1, actor, max } = await approvalSetup();
  await db.insert(userPermissions).values({
    userId: max.id,
    outletId: o1.id,
    permissionId: await permissionId('approval.grant'),
    effect: 'revoke',
  });
  await expect(
    rbac.requireOrApprove(actor, 'table.merge', { approverUserId: max.id, pin: PIN }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('an approver with no PIN is FORBIDDEN, never a 401 that signs the cashier out', async () => {
  const { o1, actor } = await approvalSetup();
  const may = await addUser('may');
  await assign(may.id, o1.id, 'manager');
  await expect(
    rbac.requireOrApprove(actor, 'table.merge', { approverUserId: may.id, pin: PIN }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Penyetuju belum punya PIN.' });
});

const wrong = (actor: Actor, approverUserId: string, permission = 'table.merge') =>
  rbac.requireOrApprove(actor, permission, { approverUserId, pin: '000000' });

test('wrong approval PINs count on the requester; the fifth blocks and is audited', async () => {
  const { actor, max } = await approvalSetup();
  // Each miss says how many tries are left, so an honest fumble stops before the block.
  for (const left of [4, 3, 2, 1])
    await expect(wrong(actor, max.id)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: `PIN salah. Sisa ${left} percobaan.`,
      cause: { reason: 'INVALID_PIN' },
    });
  await expect(wrong(actor, max.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'PIN salah 5 kali. Akses diblokir 10 menit.',
  });

  const rows = await db.select().from(auditLog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    module: 'approval',
    action: 'approval.blocked',
    actorUserId: actor.user.id,
    entityType: 'user',
    entityId: actor.user.id,
    approverUserId: null,
    after: { permission: 'table.merge', approverUserId: max.id },
  });
  expect(typeof rows[0]!.after!.blockedUntil).toBe('string');

  // The approver's own counter is untouched.
  const [approver] = await db.select().from(users).where(eq(users.id, max.id));
  expect(approver!.pinFailures).toBe(0);
});

test('a blocked requester is refused before the PIN check, for every action', async () => {
  const { actor, max } = await approvalSetup();
  for (let i = 0; i < 5; i++) await wrong(actor, max.id).catch(() => undefined);

  // Right PIN, different action: still blocked.
  await expect(
    rbac.requireOrApprove(actor, 'reservation.create', { approverUserId: max.id, pin: PIN }),
  ).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Akses diblokir. Minta manajer membuka blokir, atau coba lagi dalam 10 menit.',
  });
  // Only the one blocking row: refusals while blocked write nothing.
  expect(await db.select().from(auditLog)).toHaveLength(1);
});

test('another requester still gets approved by the same manager', async () => {
  const { o1, actor, max } = await approvalSetup();
  for (let i = 0; i < 5; i++) await wrong(actor, max.id).catch(() => undefined);

  const ken = await addUser('ken');
  await assign(ken.id, o1.id, 'kitchen');
  const other = { user: { id: ken.id }, outletId: o1.id, global: false };
  expect(
    await rbac.requireOrApprove(other, 'table.merge', { approverUserId: max.id, pin: PIN }),
  ).toMatchObject({ approverUserId: max.id });
});

test('a right PIN does not clear earlier wrong PINs, even from another approver', async () => {
  const { o1, actor, max } = await approvalSetup();
  const sue = await addUser('sue');
  await assign(sue.id, o1.id, 'supervisor');
  await withPin(sue.id);
  for (let i = 0; i < 4; i++) await wrong(actor, max.id).catch(() => undefined);
  expect(
    await rbac.requireOrApprove(actor, 'table.merge', { approverUserId: sue.id, pin: PIN }),
  ).toMatchObject({ approverUserId: sue.id });
  await expect(wrong(actor, max.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'PIN salah 5 kali. Akses diblokir 10 menit.',
  });
  expect((await db.select().from(auditLog)).filter((r) => r.action === 'approval.blocked')).toHaveLength(1);
});

test('right PINs alone never block', async () => {
  const { actor, max } = await approvalSetup();
  for (let i = 0; i < 6; i++)
    await rbac.requireOrApprove(actor, 'table.merge', { approverUserId: max.id, pin: PIN });
  const [row] = await db.select().from(users).where(eq(users.id, actor.user.id));
  expect(row!.approvalFailures).toBe(0);
});

test('the block lifts by itself after 10 minutes', async () => {
  const { actor, max } = await approvalSetup();
  await db
    .update(users)
    .set({ approvalFailures: 5, approvalWindowStartedAt: new Date(Date.now() - 10 * 60_000 - 1000) })
    .where(eq(users.id, actor.user.id));
  expect(
    await rbac.requireOrApprove(actor, 'table.merge', { approverUserId: max.id, pin: PIN }),
  ).toMatchObject({ approverUserId: max.id });
});

test('concurrent wrong approval PINs each count, so a batched burst still blocks', async () => {
  const { actor, max } = await approvalSetup();
  await Promise.allSettled(Array.from({ length: 10 }, () => wrong(actor, max.id)));
  await expect(
    rbac.requireOrApprove(actor, 'table.merge', { approverUserId: max.id, pin: PIN }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const [row] = await db.select().from(users).where(eq(users.id, actor.user.id));
  expect(row!.approvalFailures).toBeGreaterThanOrEqual(5);
  expect((await db.select().from(auditLog)).filter((r) => r.action === 'approval.blocked')).toHaveLength(1);
});

test('approvers lists PIN holders who may approve here, never the caller', async () => {
  const { o1, actor, max } = await approvalSetup();
  const wes = await addUser('wes');
  await assign(wes.id, o1.id, 'waiter');
  await withPin(wes.id); // has a PIN, lacks approval.grant
  const may = await addUser('may');
  await assign(may.id, o1.id, 'manager'); // no PIN
  const o2 = await addOutlet('O2');
  const ola = await addUser('ola');
  await assign(ola.id, o2.id, 'manager');
  await withPin(ola.id); // another outlet
  const own = await addUser('own', 'owner');
  await withPin(own.id); // global role

  expect((await rbac.approvers(actor, 'table.merge')).map((a) => a.name)).toEqual(['max', 'own']);
  const self = { user: { id: max.id }, outletId: o1.id, global: false };
  expect((await rbac.approvers(self, 'table.merge')).map((a) => a.name)).toEqual(['own']);
});

const block = (userId: string) =>
  db
    .update(users)
    .set({ approvalFailures: 5, approvalWindowStartedAt: new Date() })
    .where(eq(users.id, userId));

test('unblock clears the block and audits who unblocked whom', async () => {
  const { o1, kim, max } = await approvalSetup();
  await block(kim.id);
  const manager = { user: { id: max.id }, outletId: o1.id, global: false };

  expect(await rbac.unblock(manager, kim.id)).toEqual({ success: true });

  const [row] = await db.select().from(users).where(eq(users.id, kim.id));
  expect(row).toMatchObject({ approvalFailures: 0, approvalWindowStartedAt: null });
  const rows = await db.select().from(auditLog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    module: 'approval',
    action: 'approval.unblocked',
    actorUserId: max.id,
    entityType: 'user',
    entityId: kim.id,
    after: { blockedUntil: null },
  });
  expect(typeof rows[0]!.before!.blockedUntil).toBe('string');
});

test('unblocking someone who is not blocked writes nothing', async () => {
  const { o1, kim, max } = await approvalSetup();
  const manager = { user: { id: max.id }, outletId: o1.id, global: false };
  expect(await rbac.unblock(manager, kim.id)).toEqual({ success: true });
  expect(await db.select().from(auditLog)).toHaveLength(0);
});

test('unblock refuses a user who does not work at the caller outlet', async () => {
  const { o1, max } = await approvalSetup();
  const o2 = await addOutlet('O2');
  const zed = await addUser('zed');
  await assign(zed.id, o2.id, 'cashier');
  await block(zed.id);
  const manager = { user: { id: max.id }, outletId: o1.id, global: false };
  await expect(rbac.unblock(manager, zed.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Outlet tidak ditemukan.',
  });
});

test('a manager cannot unblock themselves', async () => {
  const { o1, max } = await approvalSetup();
  await block(max.id);
  const manager = { user: { id: max.id }, outletId: o1.id, global: false };
  await expect(rbac.unblock(manager, max.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Tidak bisa membuka blokir sendiri.',
  });
  const [row] = await db.select().from(users).where(eq(users.id, max.id));
  expect(row!.approvalFailures).toBe(5);
  expect(await db.select().from(auditLog)).toHaveLength(0);
});
