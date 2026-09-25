import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { settings } from '../db/schema';

export interface AppSettings {
  /** Tablets park the active session after this long without a touch. */
  idleTimeoutSeconds: number;
  /** National PPN rate in basis points (1100 = 11%), for PPN items. */
  ppnRateBp: number;
}

/** What a fresh deployment runs with until an owner saves something. Mirrors the column defaults. */
export const DEFAULT_SETTINGS: AppSettings = { idleTimeoutSeconds: 120, ppnRateBp: 1100 };

const toSettings = (row: { idleTimeoutSeconds: number; ppnRateBp: number }): AppSettings => ({
  idleTimeoutSeconds: row.idleTimeoutSeconds,
  ppnRateBp: row.ppnRateBp,
});

@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(): Promise<AppSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, 1));
    return row ? toSettings(row) : DEFAULT_SETTINGS;
  }

  /**
   * Upsert of the single row, so the first save does not need a seeded row to update. Takes a
   * partial: each caller saves only its own field and leaves the others as they are.
   */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const [row] = await this.db
      .insert(settings)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: settings.id, set: { ...patch, updatedAt: new Date() } })
      .returning();
    return toSettings(row!);
  }
}
