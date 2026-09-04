import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';

const { roles, users } = schema;

/**
 * The first owner, so a fresh database can be logged into. Dev credentials —
 * change the password before this ever faces a real till.
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

  console.log(inserted.length ? `users: ${OWNER.username}/${OWNER.password} created` : 'users: owner already exists');
}
