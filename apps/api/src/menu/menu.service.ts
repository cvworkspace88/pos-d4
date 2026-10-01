import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { AddonService, type AddonGroupOutput } from '../addon/addon.service';
import { CategoryService, type CategoryListOutput } from '../category/category.service';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { DRIZZLE, type Database, type Tx } from '../db/db.module';
import { conflictHandler } from '../db/errors';
import {
  addonGroups,
  categories,
  menuItemAddonGroups,
  menuItems,
  menuVariants,
  outlets,
  type SoldBy,
  type Tax,
} from '../db/schema';
import { requireStation } from './kitchen-station';
import {
  duplicateName,
  effectiveStationId,
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
  /** Short name printed on kitchen tickets. Null: the name. */
  kitchenName: string | null;
  description: string | null;
  imageUrl: string | null;
  price: number;
  cost: number | null;
  tax: Tax;
  /** Overrides the category's station; a station of the same outlet. Null: inherit. */
  kitchenStationId: string | null;
  soldBy: SoldBy;
  /** Off: hidden from the outlet's cashier screen. Not a delete, not sold-out (US-018). */
  active: boolean;
  /** The whole set. Non-empty: the item is sold as one of these, and `price`/`cost` are derived. */
  variants: VariantInput[];
  /** In display order; repeats are dropped. Groups of the same outlet. */
  addonGroupIds: string[];
}

export type MenuItemOutput = Omit<MenuItemInput, 'variants'> & {
  id: string;
  categoryName: string;
  /** Where a line routes: the item's own station, else the category's. Null: the outlet's default. */
  stationId: string | null;
  sortOrder: number;
  variants: Variant[];
};

/** One outlet's whole menu, as its cashier screen loads it: three flat lists, linked by id. */
export interface MenuOutput {
  categories: CategoryListOutput[];
  items: MenuItemOutput[];
  addonGroups: AddonGroupOutput[];
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Menu tidak ditemukan.' });
const categoryNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });
const variantNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Varian tidak ditemukan.' });
const addonNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Add-on tidak ditemukan.' });

/** Maps by the index Postgres names: name and code each have their own message. */
const rethrowAsConflict = conflictHandler(menuConflictMessage);

/** Live menu items of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(menuItems.outletId, outletId), isNull(menuItems.deletedAt));

/** An item as the audit log stores it: the category by name, variants without ids, no derived fields. */
const snapshot = (item: MenuItemOutput | undefined) =>
  item && {
    categoryName: item.categoryName,
    code: item.code,
    name: item.name,
    kitchenName: item.kitchenName,
    description: item.description,
    imageUrl: item.imageUrl,
    price: item.price,
    cost: item.cost,
    tax: item.tax,
    kitchenStationId: item.kitchenStationId,
    soldBy: item.soldBy,
    sortOrder: item.sortOrder,
    active: item.active,
    variants: item.variants.map(({ name, price, cost, available }) => ({ name, price, cost, available })),
    addonGroupIds: item.addonGroupIds,
  };

/** The audit fields every menu item change shares. */
const entry = (outletId: string, entityId: string) =>
  ({ outletId, module: 'menu', entityType: 'menu_item', entityId }) as const;

@Injectable()
export class MenuService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(AddonService) private readonly addons: AddonService,
  ) {}

  /** Everything the outlet's clients need in one round trip. Sold-out arrives with US-018. */
  async list(outletId: string): Promise<MenuOutput> {
    const [categoryRows, items, groups] = await Promise.all([
      this.categories.list(outletId),
      this.items(outletId),
      this.addons.list(outletId),
    ]);
    return { categories: categoryRows, items, addonGroups: groups };
  }

  /** Live items in the cashier screen's order: category position, item position, name. `id` narrows to one. */
  async items(outletId: string, id?: string, db: Pick<Tx, 'select'> = this.db): Promise<MenuItemOutput[]> {
    const rows = await db
      .select({
        id: menuItems.id,
        categoryId: menuItems.categoryId,
        categoryName: categories.name,
        categoryStationId: categories.kitchenStationId,
        code: menuItems.code,
        name: menuItems.name,
        kitchenName: menuItems.kitchenName,
        description: menuItems.description,
        imageUrl: menuItems.imageUrl,
        price: menuItems.price,
        cost: menuItems.cost,
        tax: menuItems.tax,
        kitchenStationId: menuItems.kitchenStationId,
        soldBy: menuItems.soldBy,
        sortOrder: menuItems.sortOrder,
        active: menuItems.active,
      })
      .from(menuItems)
      .innerJoin(categories, eq(categories.id, menuItems.categoryId))
      .where(and(liveAt(outletId), id ? eq(menuItems.id, id) : undefined))
      .orderBy(asc(categories.sortOrder), asc(menuItems.sortOrder), asc(menuItems.name));
    if (!rows.length) return [];
    const ids = rows.map((i) => i.id);

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
    return rows.map(({ categoryStationId, ...item }) => ({
      ...item,
      stationId: effectiveStationId(item, { kitchenStationId: categoryStationId }),
      variants: variants
        .filter((v) => v.menuItemId === item.id)
        .map((v) => ({ id: v.id, name: v.name, price: v.price, cost: v.cost, available: v.available })),
      addonGroupIds: links.filter((l) => l.menuItemId === item.id).map((l) => l.addonGroupId),
    }));
  }

  /** The rates the menu form shows beside each tax, both the outlet's own. */
  async taxRates(outletId: string): Promise<{ pbjtRateBp: number; ppnRateBp: number }> {
    const [outlet] = await this.db
      .select({ pbjtRateBp: outlets.pbjtRateBp, ppnRateBp: outlets.ppnRateBp })
      .from(outlets)
      .where(eq(outlets.id, outletId));
    return outlet ?? { pbjtRateBp: 0, ppnRateBp: 0 };
  }

  create(actor: Actor, outletId: string, input: MenuItemInput): Promise<MenuItemOutput> {
    return this.save(actor, outletId, null, input);
  }

  /** Configuration, not a bill: two managers saving the same item is last write wins. */
  update(actor: Actor, outletId: string, id: string, input: MenuItemInput): Promise<MenuItemOutput> {
    return this.save(actor, outletId, id, input);
  }

  /** The on/off switch on its own, so flipping it cannot overwrite a price edited elsewhere. */
  async setActive(
    actor: Actor,
    outletId: string,
    id: string,
    active: boolean,
  ): Promise<{ id: string; active: boolean }> {
    return this.db.transaction(async (tx) => {
      const [old] = await this.lockItem(tx, outletId, id);
      if (!old) throw notFound();
      const [row] = await tx
        .update(menuItems)
        .set({ active })
        .where(eq(menuItems.id, id))
        .returning({ id: menuItems.id, active: menuItems.active });
      await audit(tx, actor, {
        ...entry(outletId, id),
        action: 'menu.item_set_active',
        before: { name: old.name, active: old.active },
        after: { name: old.name, active },
      });
      return row!;
    });
  }

  /** Soft delete: order lines will point at it, and a deleted name can be reused. */
  async delete(actor: Actor, outletId: string, id: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      const [old] = await this.lockItem(tx, outletId, id);
      if (!old) throw notFound();
      const [before] = await this.items(outletId, id, tx);
      await tx.update(menuItems).set({ deletedAt: new Date() }).where(eq(menuItems.id, id));
      await audit(tx, actor, {
        ...entry(outletId, id),
        action: 'menu.item_delete',
        before: snapshot(before),
      });
    });
    return { success: true };
  }

  /** The live item row, held `FOR UPDATE`: what an audited write reads as `before` cannot move under it. */
  private lockItem(tx: Tx, outletId: string, id: string) {
    return tx
      .select({ name: menuItems.name, active: menuItems.active })
      .from(menuItems)
      .where(and(eq(menuItems.id, id), liveAt(outletId)))
      .for('update');
  }

  /** One transaction: the item row, then its variant set, then its add-on links, then the read-back. */
  private async save(
    actor: Actor,
    outletId: string,
    id: string | null,
    input: MenuItemInput,
  ): Promise<MenuItemOutput> {
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
        if (fields.kitchenStationId) await requireStation(tx, outletId, fields.kitchenStationId);
        const groupIds = await this.lockAddonGroups(tx, outletId, addonGroupIds);
        if (id) await this.lockItem(tx, outletId, id);
        const [before] = id ? await this.items(outletId, id, tx) : [];
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
        const [item] = await this.items(outletId, mid, tx);
        if (!item) throw notFound();
        await audit(tx, actor, {
          ...entry(outletId, mid),
          action: id ? 'menu.item_update' : 'menu.item_create',
          before: snapshot(before),
          after: snapshot(item),
        });
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
   * The category must be live and of this outlet, and stay so until the write commits: `FOR SHARE`
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
   * Every group must be live and of this outlet, held `FOR SHARE` until commit: `AddonService.delete`
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
