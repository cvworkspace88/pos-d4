import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { seedRbac } from '../role/seed-rbac';
import * as schema from './schema';

/**
 * Applies `apps/api/drizzle` before the hub accepts requests (US-002). Same journal table as
 * `drizzle-kit migrate`, so a database migrated either way stays in step. Cloud keeps the CLI.
 *
 * Then the base roles and permissions (US-088): they come with the app, not with the setup wizard,
 * so an update that adds a permission reaches an installed hub on its next start. `seedRbac` is
 * idempotent.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool, { schema });
    // dist/db/migrate.js → apps/api/drizzle (tsc builds this project to CommonJS, so __dirname exists).
    await migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
    await seedRbac(db);
  } finally {
    await pool.end();
  }
}
