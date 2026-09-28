import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { categories, menuItems, type Category } from '../db/schema';
import { checkReorder } from './category-rules';

const categoryOutput = (c: Category) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder });
export type CategoryOutput = ReturnType<typeof categoryOutput>;
/** A list row also says how many live menu items sit in the category. */
export type CategoryListOutput = CategoryOutput & { itemCount: number };

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' });

/** The only unique index on this table is the live name, so any unique violation is a duplicate name. */
const rethrowAsConflict = (error: unknown): never => {
  if (isUniqueViolation(error))
    throw new TRPCError({ code: 'CONFLICT', message: 'Nama kategori sudah dipakai.' });
  throw error;
};

/** Live categories of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(categories.outletId, outletId), isNull(categories.deletedAt));

@Injectable()
export class CategoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(outletId: string): Promise<CategoryListOutput[]> {
    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        sortOrder: categories.sortOrder,
        itemCount: count(menuItems.id),
      })
      .from(categories)
      .leftJoin(menuItems, and(eq(menuItems.categoryId, categories.id), isNull(menuItems.deletedAt)))
      .where(liveAt(outletId))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
  }

  /** Appended after the last live category. */
  async create(outletId: string, name: string): Promise<CategoryOutput> {
    try {
      const [row] = await this.db
        .insert(categories)
        .values({
          outletId,
          name,
          sortOrder: sql`(select coalesce(max(${categories.sortOrder}) + 1, 0) from ${categories}
            where ${categories.outletId} = ${outletId} and ${categories.deletedAt} is null)`,
        })
        .returning();
      return categoryOutput(row!);
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }

  async rename(outletId: string, id: string, name: string): Promise<CategoryOutput> {
    try {
      const [row] = await this.db
        .update(categories)
        .set({ name })
        .where(and(eq(categories.id, id), liveAt(outletId)))
        .returning();
      if (!row) throw notFound();
      return categoryOutput(row);
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
  async delete(outletId: string, id: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      const [live] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, id), liveAt(outletId)))
        .for('update');
      if (!live) throw notFound();
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
    });
    return { success: true };
  }

  /**
   * `ids` must be every live category, once. The rows are locked first, so a delete or rename from
   * another tablet waits for this transaction; a create isn't locked by `FOR UPDATE` and can slip in
   * regardless — it simply lands at the end, and the next reorder fixes it.
   * Same set, different order from another tablet: last write wins — this is configuration.
   */
  async reorder(outletId: string, ids: string[]): Promise<CategoryOutput[]> {
    await this.db.transaction(async (tx) => {
      const live = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(liveAt(outletId))
        .for('update');
      if (
        !checkReorder(
          live.map((r) => r.id),
          ids,
        )
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Urutan kategori berubah. Muat ulang lalu coba lagi.',
        });
      for (const [sortOrder, id] of ids.entries())
        await tx.update(categories).set({ sortOrder }).where(eq(categories.id, id));
    });
    return this.list(outletId);
  }
}
