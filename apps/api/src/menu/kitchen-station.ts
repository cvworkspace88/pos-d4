import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { kitchenStations } from '../db/schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A category or item may point only at a live station of its own outlet. Retired ones stay in the
 * table because old rows reference them, so "exists" is not enough. Read inside the caller's
 * transaction.
 */
// ponytail: no FOR SHARE yet - nothing writes kitchen_stations. When US-036 adds retire, lock here with .for('share') and retire FOR UPDATE, like lockCategory.
export const requireStation = async (db: Pick<Tx, 'select'>, outletId: string, id: string): Promise<void> => {
  const [row] = await db
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, id),
        eq(kitchenStations.outletId, outletId),
        eq(kitchenStations.active, true),
      ),
    );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stasiun dapur tidak ditemukan.' });
};
