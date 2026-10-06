import { asc, isNull } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { outlets } from '../db/schema';

/**
 * The outlet a `local` hub serves (US-003): what `hub.info` reports, the QR carries and sign-in is bound to
 * (US-008). Null until first-run setup (US-088) has made one.
 */
// ponytail: one hub per outlet (US-053 v1 ceiling), so the first live outlet is the hub's. A hub serving
// several outlets would need an explicit "this hub's outlet" setting.
export async function hubOutlet(db: Database): Promise<{ id: string; name: string } | null> {
  const [outlet] = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .orderBy(asc(outlets.createdAt))
    .limit(1);
  return outlet ?? null;
}
