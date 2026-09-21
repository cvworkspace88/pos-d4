import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';

const { outlets } = schema;

/**
 * The first outlet, so a fresh database can be logged into with a session that has an active one —
 * `auth.login` returns `outlet: null` when there are none and the clients have nowhere to go.
 */
export const OUTLET = { name: 'Cafe Melati', code: 'CME' };

/** Idempotent: both unique indexes are on live rows, so a re-run conflicts and writes nothing. */
export async function seedOutlets(db: NodePgDatabase<typeof schema>): Promise<void> {
  const inserted = await db
    .insert(outlets)
    .values(OUTLET)
    .onConflictDoNothing()
    .returning({ id: outlets.id });

  console.log(
    inserted.length ? `outlets: ${OUTLET.name} (${OUTLET.code}) created` : 'outlets: already exists',
  );
}
