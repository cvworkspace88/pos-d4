import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { DRIZZLE, type Database } from '../db/db.module';
import { settings } from '../db/schema';

export interface AppSettings {
  /** Tablets park the active session after this long without a touch. */
  idleTimeoutSeconds: number;
  /** The desktop locks its screen after this long idle. 0 = off. */
  desktopLockSeconds: number;
}

/** What a fresh deployment runs with until an owner saves something. Mirrors the column defaults. */
export const DEFAULT_SETTINGS: AppSettings = { idleTimeoutSeconds: 120, desktopLockSeconds: 0 };

const toSettings = (row: AppSettings): AppSettings => ({
  idleTimeoutSeconds: row.idleTimeoutSeconds,
  desktopLockSeconds: row.desktopLockSeconds,
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
  async update(patch: Partial<AppSettings>, actor: Actor): Promise<AppSettings> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update');
      const [row] = await tx
        .insert(settings)
        .values({ id: 1, ...patch })
        .onConflictDoUpdate({ target: settings.id, set: { ...patch, updatedAt: new Date() } })
        .returning();
      const after = toSettings(row!);
      await audit(tx, actor, {
        outletId: null,
        module: 'settings',
        action: 'settings.update',
        entityType: 'settings',
        entityId: null,
        before: old ? toSettings(old) : DEFAULT_SETTINGS,
        after,
      });
      return after;
    });
  }
}
