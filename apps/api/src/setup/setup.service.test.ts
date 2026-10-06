import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { auditLog, outlets, roles, users } from '../db/schema';
import { seedRbac } from '../role/seed-rbac';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { SetupService, type SetupInput } from './setup.service';

let db: TestDatabase;
let close: () => Promise<void>;
let setup: SetupService;

const INPUT: SetupInput = {
  outlet: {
    name: 'Kopi Senja',
    code: 'ks1',
    address: 'Jl. Melati 1',
    timezone: 'Asia/Makassar',
    businessDayCutoff: '05:30',
  },
  owner: { name: 'Budi', username: 'Budi', password: 'password123', pin: '246810' },
};

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  await seedRbac(db);
  setup = new SetupService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

test('a database with no outlet needs setup', async () => {
  expect(await setup.status()).toEqual({ needed: true });
});

test('a closed outlet still counts: the install was set up once', async () => {
  await db.insert(outlets).values({ name: 'Lama', code: 'OLD', deletedAt: new Date() });
  expect(await setup.status()).toEqual({ needed: false });
});

test('run creates the outlet and a global owner with password and PIN', async () => {
  await setup.run(INPUT);

  const [outlet] = await db.select().from(outlets);
  expect(outlet).toMatchObject({
    name: 'Kopi Senja',
    code: 'KS1',
    address: 'Jl. Melati 1',
    timezone: 'Asia/Makassar',
    businessDayCutoff: '05:30:00',
  });

  const [owner] = await db.select().from(users);
  const [ownerRole] = await db.select().from(roles).where(eq(roles.name, 'owner'));
  expect(owner).toMatchObject({ name: 'Budi', username: 'budi', roleId: ownerRole!.id });
  expect(await argon2.verify(owner!.passwordHash, 'password123')).toBe(true);
  expect(await argon2.verify(owner!.pinHash!, '246810')).toBe(true);

  const [entry] = await db.select().from(auditLog);
  expect(entry).toMatchObject({ action: 'outlet.create', actorUserId: owner!.id, outletId: outlet!.id });

  expect(await setup.status()).toEqual({ needed: false });
});

test('the owner can sign in straight away, with the new outlet active', async () => {
  await setup.run(INPUT);
  const auth = new AuthService(
    db,
    new JwtService({}),
    new ConfigService({ JWT_ACCESS_SECRET: 'test-secret', JWT_ACCESS_TTL: '15m' }),
  );
  const session = await auth.login({ username: 'budi', password: 'password123' });
  expect(session.outlet?.name).toBe('Kopi Senja');
  expect(session.user.hasPin).toBe(true);
});

test('a second run is refused and changes nothing', async () => {
  await setup.run(INPUT);
  await expect(
    setup.run({ ...INPUT, owner: { ...INPUT.owner, username: 'intruder' } }),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(await db.select().from(users)).toHaveLength(1);
});

test('two runs at once: exactly one wins', async () => {
  const results = await Promise.allSettled([
    setup.run(INPUT),
    setup.run({ ...INPUT, owner: { ...INPUT.owner, username: 'other' } }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'PRECONDITION_FAILED' },
  });
  expect(await db.select().from(outlets)).toHaveLength(1);
  expect(await db.select().from(users)).toHaveLength(1);
});

test('a username already taken (no outlet yet) is CONFLICT and rolls back', async () => {
  await db.insert(users).values({ username: 'budi', name: 'Budi', passwordHash: 'x' });
  await expect(setup.run(INPUT)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await db.select().from(outlets)).toHaveLength(0);
});
