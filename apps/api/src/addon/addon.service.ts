import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, count, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Actor } from '../auth/rbac-rules';
import { DRIZZLE, type Database, type Tx } from '../db/db.module';
import { conflictHandler } from '../db/errors';
import { addonGroups, addonOptions, menuItemAddonGroups, menuItems } from '../db/schema';
import { duplicateName, hasDuplicateId } from '../menu/menu-rules';
import { addonConflictMessage, getSelectAddonErrorMessage } from './addon-rules';

export interface AddonOptionInput {
  /** Present: an existing option to update. Absent: a new one. */
  id?: string;
  name: string;
  price: number;
  available: boolean;
}

/** The full field set a form saves; `options` is the whole set, not a patch. */
export interface AddonGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: AddonOptionInput[];
}

export type AddonOption = Omit<AddonOptionInput, 'id'> & { id: string };
export type AddonGroupOutput = Omit<AddonGroupInput, 'options'> & {
  id: string;
  options: AddonOption[];
  /** Live menu items linking this group. */
  usedBy: number;
};

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Add-on tidak ditemukan.' });
const optionNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Pilihan tidak ditemukan.' });
const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

const rethrowAsConflict = conflictHandler(addonConflictMessage);

/** Live groups of one outlet. Every query goes through this, so no id crosses outlets. */
const liveAt = (outletId: string) => and(eq(addonGroups.outletId, outletId), isNull(addonGroups.deletedAt));

/** A group as the audit log stores it: option names and prices, no ids or usage counts. */
const snapshot = (g: AddonGroupOutput | undefined) =>
  g && {
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    options: g.options.map(({ name, price, available }) => ({ name, price, available })),
  };

@Injectable()
export class AddonService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** By name. `id` narrows to one group — how a save reads back what it wrote. */
  async list(outletId: string, id?: string, db: Pick<Tx, 'select'> = this.db): Promise<AddonGroupOutput[]> {
    const groups = await db
      .select({
        id: addonGroups.id,
        name: addonGroups.name,
        minSelect: addonGroups.minSelect,
        maxSelect: addonGroups.maxSelect,
      })
      .from(addonGroups)
      .where(and(liveAt(outletId), id ? eq(addonGroups.id, id) : undefined))
      .orderBy(asc(addonGroups.name));
    if (!groups.length) return [];
    const ids = groups.map((g) => g.id);

    // Independent queries: run together rather than round-trip one after the other.
    const [options, used] = await Promise.all([
      db
        .select({
          groupId: addonOptions.groupId,
          id: addonOptions.id,
          name: addonOptions.name,
          price: addonOptions.price,
          available: addonOptions.available,
        })
        .from(addonOptions)
        .where(and(inArray(addonOptions.groupId, ids), isNull(addonOptions.deletedAt)))
        .orderBy(asc(addonOptions.sortOrder)),
      db
        .select({ groupId: menuItemAddonGroups.addonGroupId, n: count() })
        .from(menuItemAddonGroups)
        .innerJoin(menuItems, eq(menuItems.id, menuItemAddonGroups.menuItemId))
        .where(and(inArray(menuItemAddonGroups.addonGroupId, ids), isNull(menuItems.deletedAt)))
        .groupBy(menuItemAddonGroups.addonGroupId),
    ]);

    return groups.map((g) => ({
      ...g,
      options: options
        .filter((o) => o.groupId === g.id)
        .map((o) => ({ id: o.id, name: o.name, price: o.price, available: o.available })),
      usedBy: used.find((u) => u.groupId === g.id)?.n ?? 0,
    }));
  }

  create(actor: Actor, outletId: string, input: AddonGroupInput): Promise<AddonGroupOutput> {
    return this.save(actor, outletId, null, input);
  }

  /** Configuration, not a bill: two managers saving the same group is last write wins. */
  update(actor: Actor, outletId: string, id: string, input: AddonGroupInput): Promise<AddonGroupOutput> {
    return this.save(actor, outletId, id, input);
  }

  /** Soft-deletes the group and its options; its links go (they are config). */
  async delete(actor: Actor, outletId: string, id: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      // FOR UPDATE waits out a menu save holding this group FOR SHARE, so no link lands after the unlink.
      const [row] = await tx
        .select({ id: addonGroups.id })
        .from(addonGroups)
        .where(and(eq(addonGroups.id, id), liveAt(outletId)))
        .for('update');
      if (!row) throw notFound();
      const [before] = await this.list(outletId, id, tx);
      const now = new Date();
      await tx.delete(menuItemAddonGroups).where(eq(menuItemAddonGroups.addonGroupId, id));
      await tx
        .update(addonOptions)
        .set({ deletedAt: now })
        .where(and(eq(addonOptions.groupId, id), isNull(addonOptions.deletedAt)));
      await tx.update(addonGroups).set({ deletedAt: now }).where(eq(addonGroups.id, id));
      await audit(tx, actor, {
        outletId,
        module: 'addon',
        action: 'addon.delete',
        entityType: 'addon_group',
        entityId: id,
        before: snapshot(before),
      });
    });
    return { success: true };
  }

  /** One transaction: the group row, its option set (ids kept, new inserted, left-out soft-deleted), the read-back. */
  private async save(
    actor: Actor,
    outletId: string,
    id: string | null,
    input: AddonGroupInput,
  ): Promise<AddonGroupOutput> {
    const { options, ...fields } = input;
    const dup = duplicateName(options);
    if (dup) throw badRequest(`Nama pilihan "${dup}" dipakai dua kali.`);
    if (hasDuplicateId(options)) throw badRequest('Pilihan terkirim dua kali. Muat ulang lalu simpan lagi.');
    const invalid = getSelectAddonErrorMessage({
      min: fields.minSelect,
      max: fields.maxSelect,
      optionCount: options.length,
    });
    if (invalid) throw badRequest(invalid);

    try {
      return await this.db.transaction(async (tx) => {
        // Locked first, so `before` is what this save actually replaces.
        if (id)
          await tx
            .select({ id: addonGroups.id })
            .from(addonGroups)
            .where(and(eq(addonGroups.id, id), liveAt(outletId)))
            .for('update');
        const [before] = id ? await this.list(outletId, id, tx) : [];
        const [saved] = id
          ? await tx
              .update(addonGroups)
              .set(fields)
              .where(and(eq(addonGroups.id, id), liveAt(outletId)))
              .returning({ id: addonGroups.id })
          : await tx
              .insert(addonGroups)
              .values({ outletId, ...fields })
              .returning({ id: addonGroups.id });
        if (!saved) throw notFound();
        const gid = saved.id;

        const kept = options.flatMap((o) => (o.id ? [o.id] : []));
        await tx
          .update(addonOptions)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(addonOptions.groupId, gid),
              isNull(addonOptions.deletedAt),
              kept.length ? notInArray(addonOptions.id, kept) : undefined,
            ),
          );
        for (const [sortOrder, { id: optionId, ...option }] of options.entries()) {
          if (!optionId) {
            await tx.insert(addonOptions).values({ groupId: gid, sortOrder, ...option });
            continue;
          }
          const [row] = await tx
            .update(addonOptions)
            .set({ sortOrder, ...option })
            .where(
              and(
                eq(addonOptions.id, optionId),
                eq(addonOptions.groupId, gid),
                isNull(addonOptions.deletedAt),
              ),
            )
            .returning({ id: addonOptions.id });
          if (!row) throw optionNotFound();
        }
        // Inside the transaction, so a delete landing right after commit cannot turn this save into NOT_FOUND.
        const [group] = await this.list(outletId, gid, tx);
        if (!group) throw notFound();
        await audit(tx, actor, {
          outletId,
          module: 'addon',
          action: id ? 'addon.update' : 'addon.create',
          entityType: 'addon_group',
          entityId: gid,
          before: snapshot(before),
          after: snapshot(group),
        });
        return group;
      });
    } catch (error) {
      return rethrowAsConflict(error);
    }
  }
}
