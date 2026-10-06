import * as argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import * as schema from '../../src/db/schema.ts';

const { roles, users } = schema;

/**
 * The first owner, so a fresh database can be logged into. Dev credentials —
 * change the password before this ever faces a real till. The role goes on `users.role_id`:
 * that is the GLOBAL role, which is why the owner needs no `outlet_staff` row.
 */
export const OWNER = { username: 'owner', password: 'owner123', name: 'Owner' };

/** Idempotent: an existing `owner` row is left exactly as it is. */
export async function seedOwner(db: NodePgDatabase<typeof schema>): Promise<void> {
  const [ownerRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'owner'));
  if (!ownerRole) throw new Error('owner role missing — run seedRbac first');

  const inserted = await db
    .insert(users)
    .values({
      username: OWNER.username,
      name: OWNER.name,
      passwordHash: await argon2.hash(OWNER.password),
      roleId: ownerRole.id,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  console.log(
    inserted.length ? `users: ${OWNER.username}/${OWNER.password} created` : 'users: owner already exists',
  );
}

// Bounds mirror `outlet.addStaff`, so `prod:init` accepts exactly what the staff form would.
const ownerInput = z.object({
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
});

/**
 * The first owner of a real (cloud) deployment, for `pnpm prod:init`. No PIN — they set one at
 * first sign-in — and no outlet: they create it in the backoffice (`outlet.create`). Refused once
 * any live user holds the owner role, so the script cannot slip in a second owner later.
 */
export async function createOwner(
  db: NodePgDatabase<typeof schema>,
  input: z.input<typeof ownerInput>,
): Promise<string> {
  const { name, username, password } = ownerInput.parse(input);
  const [ownerRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'owner'));
  if (!ownerRole) throw new Error('owner role missing — run `pnpm db:seed` first');

  const [existing] = await db
    .select({ username: users.username })
    .from(users)
    .where(and(eq(users.roleId, ownerRole.id), isNull(users.deletedAt)));
  if (existing) throw new Error(`This database already has an owner (${existing.username}).`);

  await db.insert(users).values({
    name,
    username: username.toLowerCase(),
    passwordHash: await argon2.hash(password),
    roleId: ownerRole.id,
  });
  return username.toLowerCase();
}
