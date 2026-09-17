import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../db/schema';

export type TestDatabase = NodePgDatabase<typeof schema>;

// Resolved against the workspace root. Both vitest and turbo run this package's tasks with
// `apps/api` as the working directory; `import.meta` is not an option, since tsc builds this
// project to CommonJS.
const root = (path: string) => resolve(process.cwd(), path);

/**
 * Its own database, never the one `pnpm dev` points at: these tests truncate between cases, and
 * doing that to a developer's working data would be unforgivable. Derived from `DATABASE_URL` by
 * suffixing the database name, so there is nothing extra to configure.
 */
const testDatabaseUrl = (): string => {
  // vitest does not read .env, and neither does anything else in this process.
  try {
    process.loadEnvFile(root('.env'));
  } catch {
    // Already exported in the environment, or no file — DATABASE_URL below is the real check.
  }
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error('DATABASE_URL is unset — add it to apps/api/.env or set TEST_DATABASE_URL.');

  const url = new URL(base);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
};

/** `CREATE DATABASE` cannot run against the database being created, so it goes through `postgres`. */
const ensureDatabase = async (url: string): Promise<void> => {
  const name = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const pool = new Pool({ connectionString: admin.toString(), connectionTimeoutMillis: 3000 });
  try {
    const existing = await pool.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) await pool.query(`create database "${name}"`);
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres at ${admin.host}. Start it with \`docker compose up -d cloud\`.`,
      { cause: error },
    );
  } finally {
    await pool.end();
  }
};

/** Connects to the test database, creating and migrating it on first use. */
export const connectTestDatabase = async (): Promise<{
  db: TestDatabase;
  close: () => Promise<void>;
}> => {
  const url = testDatabaseUrl();
  await ensureDatabase(url);

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  const db = drizzle(pool, { schema });
  // The same migrations the real database runs, so a schema change cannot pass here and fail there.
  await migrate(db, { migrationsFolder: root('drizzle') });
  return { db, close: () => pool.end() };
};

/** Every table these tests touch, plus whatever cascades off `users`. */
export const truncateAll = async (db: TestDatabase): Promise<void> => {
  await db.execute(sql`truncate table outlet_staff, outlets, users restart identity cascade`);
};
