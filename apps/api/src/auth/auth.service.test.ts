import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { outletStaff, outlets, refreshTokens, roles, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { AuthService } from './auth.service';

let db: TestDatabase;
let close: () => Promise<void>;
let auth: AuthService;
let roleId: Record<string, string>;

const PASSWORD = 'password123';
let passwordHash: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  passwordHash = await argon2.hash(PASSWORD);
  auth = new AuthService(
    db,
    new JwtService({}),
    new ConfigService({ JWT_ACCESS_SECRET: 'test-secret', JWT_ACCESS_TTL: '15m' }),
  );
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
    .values({ username, name: username, passwordHash, roleId: globalRole ? roleId[globalRole] : null })
    .returning();
  return row!;
};

const addOutlet = async (name: string) => {
  const [row] = await db.insert(outlets).values({ name, code: name }).returning();
  return row!;
};

const assign = (userId: string, outletId: string, role = 'cashier') =>
  db.insert(outletStaff).values({ userId, outletId, roleId: roleId[role]! });

const login = (username: string) => auth.login({ username, password: PASSWORD });

test('login auto-stamps the only outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  await assign(ann.id, o1.id);

  const session = await login('ann');
  expect(session.outlet).toEqual({ id: o1.id, name: 'One' });
  expect(session.outlets).toEqual([{ id: o1.id, name: 'One' }]);
  expect((await auth.userFromAccessToken(session.accessToken)).outletId).toBe(o1.id);
});

test('login with many outlets leaves the choice to the client', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const session = await login('ann');
  expect(session.outlet).toBeNull();
  expect(session.outlets.map((o) => o.name)).toEqual(['One', 'Two']);
});

test('login with no outlets is allowed and says so', async () => {
  await addUser('ann');
  const session = await login('ann');
  expect(session.outlet).toBeNull();
  expect(session.outlets).toEqual([]);
});

test('a global role sees every live outlet', async () => {
  const owner = await addUser('owner', 'owner');
  await addOutlet('One');
  const gone = await addOutlet('Gone');
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, gone.id));

  const session = await login('owner');
  expect(session.outlets.map((o) => o.name)).toEqual(['One']);
  expect(session.outlet?.name).toBe('One');
  expect(session.user.id).toBe(owner.id);
});

test('refresh with an outletId stamps it; without one it carries forward', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const first = await login('ann');
  const picked = await auth.refresh(first.refreshToken, o2.id);
  expect(picked.outlet?.id).toBe(o2.id);

  const carried = await auth.refresh(picked.refreshToken);
  expect(carried.outlet?.id).toBe(o2.id);
  expect((await auth.userFromAccessToken(carried.accessToken)).outletId).toBe(o2.id);
});

test('refresh with an outlet the user is not assigned to is FORBIDDEN and consumes nothing', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);

  const first = await login('ann');
  await expect(auth.refresh(first.refreshToken, o2.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Outlet tidak ditemukan.',
  });
  // The token is still live: the refusal happened before rotation. Checked directly, not just via
  // a follow-up refresh — a buggy rotate-then-throw would still leave a refreshable row (the
  // rotation grace window), so the row itself is what must show no rotation happened.
  const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, ann.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.revokedAt).toBeNull();
  const again = await auth.refresh(first.refreshToken);
  expect(again.outlet?.id).toBe(o1.id);
});

test('an outlet that closed comes back as null when a choice remains', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  const o3 = await addOutlet('Three');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);
  await assign(ann.id, o3.id);

  const session = await auth.refresh((await login('ann')).refreshToken, o1.id);
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, o1.id));

  const next = await auth.refresh(session.refreshToken);
  expect(next.outlet).toBeNull();
  expect(next.outlets.map((o) => o.name)).toEqual(['Three', 'Two']);
});

test('losing a membership falls back to the one outlet left, same rule as login', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const session = await auth.refresh((await login('ann')).refreshToken, o1.id);
  await db.delete(outletStaff).where(eq(outletStaff.outletId, o1.id));

  const next = await auth.refresh(session.refreshToken);
  expect(next.outlet?.id).toBe(o2.id);
});

test('pinLogin carries the parked row outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);
  await auth.setPin(ann.id, { pin: '123456' });

  const session = await auth.refresh((await login('ann')).refreshToken, o2.id);
  await auth.park(session.refreshToken);

  const unlocked = await auth.pinLogin(session.refreshToken, '123456');
  expect(unlocked.outlet?.id).toBe(o2.id);
});

test('the refresh row records the outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  await assign(ann.id, o1.id);
  await login('ann');

  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, ann.id));
  expect(row?.outletId).toBe(o1.id);
});
