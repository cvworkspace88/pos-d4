import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies `apps/api/drizzle` before the hub accepts requests (US-002). Same journal table as
 * `drizzle-kit migrate`, so a database migrated either way stays in step. Cloud keeps the CLI.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    // dist/db/migrate.js → apps/api/drizzle (tsc builds this project to CommonJS, so __dirname exists).
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}
