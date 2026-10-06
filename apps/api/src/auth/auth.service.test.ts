import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../role/seed-rbac';
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
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());

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

test('five wrong PINs lock the PIN, even against the right one', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());
  const session = await login('ann');
  await auth.park(session.refreshToken);

  for (let i = 0; i < 5; i++)
    await expect(auth.pinLogin(session.refreshToken, '000000')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { reason: 'INVALID_PIN' },
    });

  // FORBIDDEN, not UNAUTHORIZED: the profile is fine, the PIN is just resting.
  await expect(auth.pinLogin(session.refreshToken, '123456')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.',
    cause: { reason: 'LOCKED' },
  });
});

test('a right PIN resets the wrong-PIN count', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());
  const session = await login('ann');
  await auth.park(session.refreshToken);

  for (let i = 0; i < 4; i++) await expect(auth.pinLogin(session.refreshToken, '000000')).rejects.toThrow();
  await auth.pinLogin(session.refreshToken, '123456');

  const [row] = await db.select().from(users).where(eq(users.id, ann.id));
  expect(row).toMatchObject({ pinFailures: 0, pinWindowStartedAt: null });
});

const wrongLogin = (username: string) => auth.login({ username, password: 'wrong-password' });

test('five wrong passwords lock login for fifteen minutes, even against the right one', async () => {
  await addUser('ann');

  for (let i = 0; i < 5; i++) await expect(wrongLogin('ann')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

  // FORBIDDEN, not UNAUTHORIZED: a 401 would end a client session, and this is a wait, not a bad token.
  await expect(login('ann')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.',
    cause: { reason: 'LOCKED' },
  });
});

test('a right password resets the wrong-password count', async () => {
  const ann = await addUser('ann');

  for (let i = 0; i < 4; i++) await expect(wrongLogin('ann')).rejects.toThrow();
  await login('ann');

  const [row] = await db.select().from(users).where(eq(users.id, ann.id));
  expect(row).toMatchObject({ passwordFailures: 0, passwordWindowStartedAt: null });
});

test('the lock expires once the window has passed', async () => {
  const ann = await addUser('ann');
  await db
    .update(users)
    .set({ passwordFailures: 5, passwordWindowStartedAt: new Date(Date.now() - 15 * 60_000 - 1000) })
    .where(eq(users.id, ann.id));

  await expect(login('ann')).resolves.toMatchObject({ user: { id: ann.id } });
});

test('setPin counts toward and obeys the password lock', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());

  for (let i = 0; i < 5; i++)
    await expect(
      auth.setPin(ann.id, { pin: '654321', password: 'wrong-password' }, null),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Password salah.',
    });

  await expect(auth.setPin(ann.id, { pin: '654321', password: PASSWORD }, null)).rejects.toMatchObject({
    cause: { reason: 'LOCKED' },
  });
  await expect(login('ann')).rejects.toMatchObject({ cause: { reason: 'LOCKED' } });
});

test('changing a PIN without the password asks for it, and does not count toward the lock', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());

  await expect(auth.setPin(ann.id, { pin: '654321' }, Date.now())).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Masukkan password untuk mengganti PIN.',
    cause: { reason: 'NEEDS_PASSWORD' },
  });
  const [row] = await db.select().from(users).where(eq(users.id, ann.id));
  expect(row!.passwordFailures).toBe(0);
});

test('the password and PIN locks are separate', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());
  const session = await login('ann');
  await auth.park(session.refreshToken);

  for (let i = 0; i < 5; i++) await expect(wrongLogin('ann')).rejects.toThrow();

  // Password locked; the parked profile still opens with its PIN.
  await expect(auth.pinLogin(session.refreshToken, '123456')).resolves.toMatchObject({
    user: { id: ann.id },
  });
});

test('a changed PIN clears the PIN lock', async () => {
  const ann = await addUser('ann');
  await auth.setPin(ann.id, { pin: '123456' }, Date.now());
  await db.update(users).set({ pinFailures: 5, pinWindowStartedAt: new Date() }).where(eq(users.id, ann.id));

  await auth.setPin(ann.id, { pin: '654321', password: PASSWORD }, null);

  const [row] = await db.select().from(users).where(eq(users.id, ann.id));
  expect(row).toMatchObject({ pinFailures: 0, pinWindowStartedAt: null });
});

test('changePassword needs the current password and obeys the password lock', async () => {
  const ann = await addUser('ann');
  const change = (currentPassword: string) =>
    auth.changePassword(ann.id, { currentPassword, newPassword: 'new-password' });

  // FORBIDDEN, not UNAUTHORIZED: a typo must not sign the user out.
  for (let i = 0; i < 5; i++)
    await expect(change('wrong-password')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Password saat ini salah.',
    });
  await expect(change(PASSWORD)).rejects.toMatchObject({ cause: { reason: 'LOCKED' } });
});

test('a changed password is the one login takes', async () => {
  await addUser('ann');
  const { user } = await login('ann');

  await auth.changePassword(user.id, { currentPassword: PASSWORD, newPassword: 'new-password' });

  await expect(login('ann')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(auth.login({ username: 'ann', password: 'new-password' })).resolves.toMatchObject({
    user: { id: user.id },
  });
});

test('unlock refuses a wrong password with FORBIDDEN and counts it toward the lock', async () => {
  const ann = await addUser('ann');

  await expect(auth.unlock(ann.id, PASSWORD)).resolves.toBeUndefined();
  for (let i = 0; i < 5; i++)
    await expect(auth.unlock(ann.id, 'wrong-password')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Password salah.',
    });
  await expect(auth.unlock(ann.id, PASSWORD)).rejects.toMatchObject({ cause: { reason: 'LOCKED' } });
});

test('a first PIN without the password needs a fresh password login', async () => {
  const ann = await addUser('ann');
  const stale = Date.now() - 6 * 60_000;

  for (const passwordAt of [stale, null])
    await expect(auth.setPin(ann.id, { pin: '123456' }, passwordAt)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Masukkan password untuk membuat PIN.',
      cause: { reason: 'NEEDS_PASSWORD' },
    });
  // A stale session may still make one by typing the password; a wrong one is refused.
  await expect(
    auth.setPin(ann.id, { pin: '123456', password: 'wrong-password' }, stale),
  ).rejects.toMatchObject({
    message: 'Password salah.',
  });
  await expect(auth.setPin(ann.id, { pin: '123456', password: PASSWORD }, stale)).resolves.toMatchObject({
    hasPin: true,
  });
});

test('only a password login marks the access token as fresh for a first PIN', async () => {
  await addUser('ann');
  const session = await login('ann');
  expect((await auth.userFromAccessToken(session.accessToken)).passwordAt).toBeGreaterThan(Date.now() - 5000);

  const refreshed = await auth.refresh(session.refreshToken);
  expect((await auth.userFromAccessToken(refreshed.accessToken)).passwordAt).toBeNull();
});
