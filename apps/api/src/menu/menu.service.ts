import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { categories, menuItems, outlets, settings, type Tax } from '../db/schema';
import { DEFAULT_SETTINGS } from '../settings/settings.service';

/** The full field set a form saves: an edit sends every field, so an omitted cost clears it. */
export interface MenuItemInput {
  categoryId: string;
  name: string;
  price: number;
  cost: number | null;
  tax: Tax;
  available: boolean;
}

export type MenuItemOutput = MenuItemInput & { id: string; categoryName: string };

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Menu tidak ditemukan.' });
const categoryNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });

/** The only unique index on this table is the live name, so any unique violation is a duplicate name. */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error))
    throw new TRPCError({ code: 'CONFLICT', message: 'Nama menu sudah dipakai.' });
  throw error;
};

/** Live menu items of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(menuItems.outletId, outletId), isNull(menuItems.deletedAt));

/** Everything the output needs but the category name, which comes from the locked category row. */
const itemColumns = {
  id: menuItems.id,
  categoryId: menuItems.categoryId,
  name: menuItems.name,
  price: menuItems.price,
  cost: menuItems.cost,
  tax: menuItems.tax,
  available: menuItems.available,
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class MenuService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** In the cashier screen's order: by category position, then name. */
  async list(outletId: string): Promise<MenuItemOutput[]> {
    return this.db
      .select({ ...itemColumns, categoryName: categories.name })
      .from(menuItems)
      .innerJoin(categories, eq(categories.id, menuItems.categoryId))
      .where(liveAt(outletId))
      .orderBy(asc(categories.sortOrder), asc(menuItems.name));
  }

  /** The rates the menu form shows beside each tax: PBJT is the outlet's, PPN the deployment's. */
  async taxRates(outletId: string): Promise<{ pbjtRateBp: number; ppnRateBp: number }> {
    const [outlet] = await this.db
      .select({ pbjtRateBp: outlets.pbjtRateBp })
      .from(outlets)
      .where(eq(outlets.id, outletId));
    const [app] = await this.db.select({ ppnRateBp: settings.ppnRateBp }).from(settings);
    return {
      pbjtRateBp: outlet?.pbjtRateBp ?? 0,
      ppnRateBp: app?.ppnRateBp ?? DEFAULT_SETTINGS.ppnRateBp,
    };
  }

  async create(outletId: string, input: MenuItemInput): Promise<MenuItemOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        const categoryName = await this.lockCategory(tx, outletId, input.categoryId);
        const [row] = await tx
          .insert(menuItems)
          .values({ outletId, ...input })
          .returning(itemColumns);
        return { ...row!, categoryName };
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /** Configuration, not a bill: two managers saving the same item is last write wins. */
  async update(outletId: string, id: string, input: MenuItemInput): Promise<MenuItemOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        const categoryName = await this.lockCategory(tx, outletId, input.categoryId);
        const [row] = await tx
          .update(menuItems)
          .set(input)
          .where(and(eq(menuItems.id, id), liveAt(outletId)))
          .returning(itemColumns);
        if (!row) throw notFound();
        return { ...row, categoryName };
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /** The sold-out switch on its own, so flipping it cannot overwrite a price edited elsewhere. */
  async setAvailable(
    outletId: string,
    id: string,
    available: boolean,
  ): Promise<{ id: string; available: boolean }> {
    const [row] = await this.db
      .update(menuItems)
      .set({ available })
      .where(and(eq(menuItems.id, id), liveAt(outletId)))
      .returning({ id: menuItems.id, available: menuItems.available });
    if (!row) throw notFound();
    return row;
  }

  /** Soft delete: order lines will point at it, and a deleted name can be reused. */
  async delete(outletId: string, id: string): Promise<{ success: true }> {
    const [row] = await this.db
      .update(menuItems)
      .set({ deletedAt: new Date() })
      .where(and(eq(menuItems.id, id), liveAt(outletId)))
      .returning({ id: menuItems.id });
    if (!row) throw notFound();
    return { success: true };
  }

  /**
   * The category must be live at this outlet, and stay so until the write commits: `FOR SHARE`
   * blocks `CategoryService.delete`, which locks the row `FOR UPDATE` before counting its items.
   */
  private async lockCategory(tx: Tx, outletId: string, categoryId: string): Promise<string> {
    const [row] = await tx
      .select({ name: categories.name })
      .from(categories)
      .where(
        and(eq(categories.id, categoryId), eq(categories.outletId, outletId), isNull(categories.deletedAt)),
      )
      .for('share');
    if (!row) throw categoryNotFound();
    return row.name;
  }
}
