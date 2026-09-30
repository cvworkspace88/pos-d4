import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { conflictHandler } from '../db/errors';
import {
  addonGroups,
  categories,
  menuItemAddonGroups,
  menuItems,
  menuVariants,
  outlets,
  settings,
  type Tax,
} from '../db/schema';
import { DEFAULT_SETTINGS } from '../settings/settings.service';
import {
  duplicateName,
  hasDuplicateId,
  menuConflictMessage,
  normalizeCode,
  startingPrice,
} from './menu-rules';

export interface VariantInput {
  /** Present: an existing variant to update. Absent: a new one. */
  id?: string;
  name: string;
  price: number;
  cost: number | null;
  available: boolean;
}

export type Variant = Omit<VariantInput, 'id'> & { id: string };

/** The full field set a form saves: an edit sends every field, so an omitted cost clears it. */
export interface MenuItemInput {
  categoryId: string;
  code: string | null;
  name: string;
  price: number;
  cost: number | null;
  tax: Tax;
  available: boolean;
  /** The whole set. Non-empty: the item is sold as one of these, and `price`/`cost` are derived. */
  variants: VariantInput[];
  /** In display order; repeats are dropped. */
  addonGroupIds: string[];
}

export type MenuItemOutput = Omit<MenuItemInput, 'variants'> & {
  id: string;
  categoryName: string;
  variants: Variant[];
};

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Menu tidak ditemukan.' });
const categoryNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });
const variantNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Varian tidak ditemukan.' });
const addonNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Add-on tidak ditemukan.' });

/** Maps by the index Postgres names: name, code and variant name each have their own message. */
const rethrowAsConflict = conflictHandler(menuConflictMessage);

/** Live menu items of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(menuItems.outletId, outletId), isNull(menuItems.deletedAt));

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class MenuService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** In the cashier screen's order: by category position, then name. `id` narrows to one item. */
  async list(outletId: string, id?: string, db: Pick<Tx, 'select'> = this.db): Promise<MenuItemOutput[]> {
    const items = await db
      .select({
        id: menuItems.id,
        categoryId: menuItems.categoryId,
        categoryName: categories.name,
        code: menuItems.code,
        name: menuItems.name,
        price: menuItems.price,
        cost: menuItems.cost,
        tax: menuItems.tax,
        available: menuItems.available,
      })
      .from(menuItems)
      .innerJoin(categories, eq(categories.id, menuItems.categoryId))
      .where(and(liveAt(outletId), id ? eq(menuItems.id, id) : undefined))
      .orderBy(asc(categories.sortOrder), asc(menuItems.name));
    if (!items.length) return [];
    const ids = items.map((i) => i.id);

    // Independent queries: run together rather than round-trip one after the other.
    const [variants, links] = await Promise.all([
      db
        .select({
          menuItemId: menuVariants.menuItemId,
          id: menuVariants.id,
          name: menuVariants.name,
          price: menuVariants.price,
          cost: menuVariants.cost,
          available: menuVariants.available,
        })
        .from(menuVariants)
        .where(and(inArray(menuVariants.menuItemId, ids), isNull(menuVariants.deletedAt)))
        .orderBy(asc(menuVariants.sortOrder)),
      db
        .select({
          menuItemId: menuItemAddonGroups.menuItemId,
          addonGroupId: menuItemAddonGroups.addonGroupId,
        })
        .from(menuItemAddonGroups)
        .where(inArray(menuItemAddonGroups.menuItemId, ids))
        .orderBy(asc(menuItemAddonGroups.sortOrder)),
    ]);

    // ponytail: per-item filter is O(items × rows); group into a Map if menus reach thousands of items.
    return items.map((item) => ({
      ...item,
      variants: variants
        .filter((v) => v.menuItemId === item.id)
        .map((v) => ({ id: v.id, name: v.name, price: v.price, cost: v.cost, available: v.available })),
      addonGroupIds: links.filter((l) => l.menuItemId === item.id).map((l) => l.addonGroupId),
    }));
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

  create(outletId: string, input: MenuItemInput): Promise<MenuItemOutput> {
    return this.save(outletId, null, input);
  }

  /** Configuration, not a bill: two managers saving the same item is last write wins. */
  update(outletId: string, id: string, input: MenuItemInput): Promise<MenuItemOutput> {
    return this.save(outletId, id, input);
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

  /** One transaction: the item row, then its variant set, then its add-on links, then the read-back. */
  private async save(outletId: string, id: string | null, input: MenuItemInput): Promise<MenuItemOutput> {
    const { variants, addonGroupIds, ...fields } = input;
    const dup = duplicateName(variants);
    if (dup) throw new TRPCError({ code: 'BAD_REQUEST', message: `Nama varian "${dup}" dipakai dua kali.` });
    if (hasDuplicateId(variants))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Varian terkirim dua kali. Muat ulang lalu simpan lagi.',
      });
    const row = {
      ...fields,
      code: normalizeCode(fields.code),
      // With variants the item price is only the "mulai dari" figure, and cost lives on each variant.
      price: variants.length ? startingPrice(variants) : fields.price,
      cost: variants.length ? null : fields.cost,
    };

    try {
      return await this.db.transaction(async (tx) => {
        await this.lockCategory(tx, outletId, fields.categoryId);
        const groupIds = await this.lockAddonGroups(tx, outletId, addonGroupIds);
        const [saved] = id
          ? await tx
              .update(menuItems)
              .set(row)
              .where(and(eq(menuItems.id, id), liveAt(outletId)))
              .returning({ id: menuItems.id })
          : await tx
              .insert(menuItems)
              .values({ outletId, ...row })
              .returning({ id: menuItems.id });
        if (!saved) throw notFound();
        const mid = saved.id;

        await this.saveVariants(tx, mid, variants);
        await tx.delete(menuItemAddonGroups).where(eq(menuItemAddonGroups.menuItemId, mid));
        if (groupIds.length)
          await tx
            .insert(menuItemAddonGroups)
            .values(
              groupIds.map((addonGroupId, sortOrder) => ({ menuItemId: mid, addonGroupId, sortOrder })),
            );
        // Inside the transaction, so a delete landing right after commit cannot turn this save into NOT_FOUND.
        const [item] = await this.list(outletId, mid, tx);
        if (!item) throw notFound();
        return item;
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /** The variant set: ids kept are updated, new rows inserted, live rows left out soft-deleted. */
  private async saveVariants(tx: Tx, menuItemId: string, variants: VariantInput[]): Promise<void> {
    const kept = variants.flatMap((v) => (v.id ? [v.id] : []));
    await tx
      .update(menuVariants)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(menuVariants.menuItemId, menuItemId),
          isNull(menuVariants.deletedAt),
          kept.length ? notInArray(menuVariants.id, kept) : undefined,
        ),
      );
    for (const [sortOrder, { id, ...variant }] of variants.entries()) {
      if (!id) {
        await tx.insert(menuVariants).values({ menuItemId, sortOrder, ...variant });
        continue;
      }
      const [row] = await tx
        .update(menuVariants)
        .set({ sortOrder, ...variant })
        .where(
          and(
            eq(menuVariants.id, id),
            eq(menuVariants.menuItemId, menuItemId),
            isNull(menuVariants.deletedAt),
          ),
        )
        .returning({ id: menuVariants.id });
      if (!row) throw variantNotFound();
    }
  }

  /**
   * The category must be live at this outlet, and stay so until the write commits: `FOR SHARE`
   * blocks `CategoryService.delete`, which locks the row `FOR UPDATE` before counting its items.
   */
  private async lockCategory(tx: Tx, outletId: string, categoryId: string): Promise<void> {
    const [row] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, categoryId), eq(categories.outletId, outletId), isNull(categories.deletedAt)),
      )
      .for('share');
    if (!row) throw categoryNotFound();
  }

  /**
   * Every group must be live at this outlet, held `FOR SHARE` until commit: `AddonService.delete`
   * locks it `FOR UPDATE` before unlinking, so no link can land on a group being deleted.
   */
  private async lockAddonGroups(tx: Tx, outletId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await tx
      .select({ id: addonGroups.id })
      .from(addonGroups)
      .where(
        and(
          inArray(addonGroups.id, unique),
          eq(addonGroups.outletId, outletId),
          isNull(addonGroups.deletedAt),
        ),
      )
      .for('share');
    if (rows.length !== unique.length) throw addonNotFound();
    return unique;
  }
}
