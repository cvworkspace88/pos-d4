import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { syncEvents } from '../db/schema';

@Injectable()
export class SyncService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Events not yet pushed to the cloud: the "N belum terkirim" badge and the shift report line. */
  async pendingCount(outletId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(syncEvents)
      .where(and(eq(syncEvents.outletId, outletId), isNull(syncEvents.syncedAt)));
    return row!.n;
  }
}
