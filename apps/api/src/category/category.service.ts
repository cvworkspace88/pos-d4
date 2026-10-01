import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { DRIZZLE, type Database } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { categories, menuItems, type Category } from '../db/schema';
import { requireStation } from '../menu/kitchen-station';
import { checkReorder } from './category-rules';

/** The full field set a form saves. `create` takes only a name (and optional colour): the rest start at their defaults. */
export interface CategoryInput {
  name: string;
  /** Tile colour on the cashier screen, `#rrggbb`. Null: the default. */
  color: string | null;
  /** Off: hidden from the cashier screen with everything in it, without deleting anything. */
  active: boolean;
  /** Where this category's items are made unless an item says otherwise. Null: the outlet's default station. */
  kitchenStationId: string | null;
}

const categoryOutput = (c: Category) => ({
  id: c.id,
  name: c.name,
  sortOrder: c.sortOrder,
  color: c.color,
  active: c.active,
  kitchenStationId: c.kitchenStationId,
});
export type CategoryOutput = ReturnType<typeof categoryOutput>;
/** A list row also says how many live menu items sit in the category. */
export type CategoryListOutput = CategoryOutput & { itemCount: number };

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });

/** The only unique index on this table is the live name per outlet, so any unique violation is a duplicate name. */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error))
    throw new TRPCError({ code: 'CONFLICT', message: 'Nama kategori sudah dipakai.' });
  throw error;
};

/** Live categories of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(categories.outletId, outletId), isNull(categories.deletedAt));

/** The audit fields every category change shares. */
const entry = (outletId: string, entityId: string | null) =>
  ({ outletId, module: 'category', entityType: 'category', entityId }) as const;

@Injectable()
export class CategoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(outletId: string): Promise<CategoryListOutput[]> {
    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        sortOrder: categories.sortOrder,
        color: categories.color,
        active: categories.active,
        kitchenStationId: categories.kitchenStationId,
        itemCount: count(menuItems.id),
      })
      .from(categories)
      .leftJoin(menuItems, and(eq(menuItems.categoryId, categories.id), isNull(menuItems.deletedAt)))
      .where(liveAt(outletId))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
  }

  /** Appended after the outlet's last live category. */
  async create(
    actor: Actor,
    outletId: string,
    name: string,
    color: string | null = null,
  ): Promise<CategoryOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(categories)
          .values({
            outletId,
            name,
            color,
            sortOrder: sql`(select coalesce(max(${categories.sortOrder}) + 1, 0) from ${categories}
              where ${categories.outletId} = ${outletId} and ${categories.deletedAt} is null)`,
          })
          .returning();
        const after = categoryOutput(row!);
        await audit(tx, actor, { ...entry(outletId, row!.id), action: 'category.create', after });
        return after;
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /** The full field set, not a patch: this is a form save. Configuration, so last write wins. */
  async update(actor: Actor, outletId: string, id: string, input: CategoryInput): Promise<CategoryOutput> {
    try {
      return await this.db.transaction(async (tx) => {
        if (input.kitchenStationId) await requireStation(tx, outletId, input.kitchenStationId);
        const [old] = await tx
          .select()
          .from(categories)
          .where(and(eq(categories.id, id), liveAt(outletId)))
          .for('update');
        if (!old) throw notFound();
        const [row] = await tx.update(categories).set(input).where(eq(categories.id, id)).returning();
        const after = categoryOutput(row!);
        await audit(tx, actor, {
          ...entry(outletId, id),
          action: 'category.update',
          before: categoryOutput(old),
          after,
        });
        return after;
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  /**
   * Soft delete. The others keep their `sort_order`; the gap is harmless. Refused while live menu
   * items point at it — they would drop off the cashier screen with no category to show under.
   * The row is locked first, so a menu save into this category (which holds it `FOR SHARE`) either
   * commits before the count below sees it, or waits and then finds the category gone.
   */
  async delete(actor: Actor, outletId: string, id: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), liveAt(outletId)))
        .for('update');
      if (!row) throw notFound();
      const [item] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.categoryId, id), isNull(menuItems.deletedAt)))
        .limit(1);
      if (item)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Kategori masih berisi menu. Pindahkan menu ke kategori lain dulu.',
        });
      await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
      await audit(tx, actor, {
        ...entry(outletId, id),
        action: 'category.delete',
        before: categoryOutput(row),
      });
    });
    return { success: true };
  }

  /**
   * `ids` must be every live category of the outlet, once. The rows are locked first, so a delete or
   * update from another tablet waits for this transaction; a create isn't locked by `FOR UPDATE` and
   * can slip in regardless — it simply lands at the end, and the next reorder fixes it.
   * Same set, different order from another tablet: last write wins — this is configuration.
   */
  async reorder(actor: Actor, outletId: string, ids: string[]): Promise<CategoryOutput[]> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(liveAt(outletId))
        .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
        .for('update');
      if (
        !checkReorder(
          rows.map((r) => r.id),
          ids,
        )
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Urutan kategori berubah. Muat ulang lalu coba lagi.',
        });
      for (const [sortOrder, id] of ids.entries())
        await tx.update(categories).set({ sortOrder }).where(eq(categories.id, id));
      // Names, not ids: the log reads "Kopi, Teh" → "Teh, Kopi".
      const name = new Map(rows.map((r) => [r.id, r.name]));
      await audit(tx, actor, {
        ...entry(outletId, null),
        action: 'category.reorder',
        before: { order: rows.map((r) => r.name) },
        after: { order: ids.map((id) => name.get(id)) },
      });
    });
    return this.list(outletId);
  }
}
