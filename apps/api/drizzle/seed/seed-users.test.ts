import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { roles, users } from '../../src/db/schema';
import { seedRbac } from '../../src/role/seed-rbac';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../../src/test/test-db';
import { createOwner } from './seed-users';

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  await seedRbac(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const INPUT = { name: ' Budi ', username: ' Budi ', password: 'password123' };

test('creates a global owner with a hashed password', async () => {
  await createOwner(db, INPUT);
  const [owner] = await db.select().from(users);
  const [ownerRole] = await db.select().from(roles).where(eq(roles.name, 'owner'));
  expect(owner).toMatchObject({ name: 'Budi', username: 'budi', roleId: ownerRole!.id, pinHash: null });
  expect(await argon2.verify(owner!.passwordHash, 'password123')).toBe(true);
});

test('refuses a second owner, whatever the username', async () => {
  await createOwner(db, INPUT);
  await expect(createOwner(db, { ...INPUT, username: 'other' })).rejects.toThrow(/already has an owner/);
  expect(await db.select().from(users)).toHaveLength(1);
});

test('refuses input the staff form would refuse', async () => {
  await expect(createOwner(db, { ...INPUT, password: 'short' })).rejects.toThrow();
  await expect(createOwner(db, { ...INPUT, username: 'ab' })).rejects.toThrow();
  expect(await db.select().from(users)).toHaveLength(0);
});
