import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';
import { seedRbac } from './seed-rbac.ts';
import { seedOwner } from './seed-users.ts';

// Run with: pnpm --filter @repo/api db:seed
const db = drizzle(process.env.DATABASE_URL!, { schema });

await seedRbac(db);
await seedOwner(db);

await db.$client.end();
