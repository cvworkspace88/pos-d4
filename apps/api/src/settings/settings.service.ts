import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { settings } from '../db/schema';

export interface AppSettings {
  /** Tablets park the active session after this long without a touch. */
  idleTimeoutSeconds: number;
}

/** What a fresh deployment runs with until an owner saves something. Mirrors the column default. */
export const DEFAULT_SETTINGS: AppSettings = { idleTimeoutSeconds: 120 };

@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(): Promise<AppSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, 1));
    return { idleTimeoutSeconds: row?.idleTimeoutSeconds ?? DEFAULT_SETTINGS.idleTimeoutSeconds };
  }

  /** Upsert of the single row, so the first save does not need a seeded row to update. */
  async update(patch: AppSettings): Promise<AppSettings> {
    const [row] = await this.db
      .insert(settings)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: settings.id, set: { ...patch, updatedAt: new Date() } })
      .returning();
    return { idleTimeoutSeconds: row!.idleTimeoutSeconds };
  }
}
