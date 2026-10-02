import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/db.module';
import { syncEvents } from '../db/schema';
import type { Actor } from '../auth/rbac-rules';

export type SyncEventEntry = {
  outletId: string;
  /** `entity.verb` e.g. 'order.created', 'payment.taken'. */
  type: `${string}.${string}`;
  entityId: string;
  /** The full entity row after the change, so the cloud can apply it as is. */
  payload: Record<string, unknown>;
};

/**
 * Records one change for the sync service to push (US-012). Call it with the transaction that makes
 * the change, so the row and its event commit or roll back together — never a change the cloud
 * misses, never an event for a change that did not happen.
 */
export const recordSyncEvent = async (
  db: Pick<Tx, 'insert'>,
  actor: Actor,
  entry: SyncEventEntry,
): Promise<void> => {
  await db.insert(syncEvents).values({ ...entry, actorUserId: actor.user.id });
};

type IdTable = PgTable & {
  id: AnyPgColumn;
  outletId: AnyPgColumn;
  $inferInsert: { id?: unknown };
  $inferSelect: { id: string; outletId: string };
};

/**
 * Safely inserts a record with a predetermined ID or fetches the existing one if it already exists.
 * Triggers a sync event only when a new record is created.
 */
export const createOnce = async <T extends IdTable>(
  tx: Tx,
  actor: Actor,
  table: T,
  values: T['$inferInsert'] & { id: string },
  event: Pick<SyncEventEntry, 'outletId' | 'type'>,
): Promise<{ row: T['$inferSelect']; created: boolean }> => {
  const [created] = (await tx
    .insert(table)
    .values(values as never) // generic T defeats drizzle's overloads; the signature keeps callers typed
    .onConflictDoNothing({ target: table.id })
    .returning()) as T['$inferSelect'][];
  if (created) {
    await recordSyncEvent(tx, actor, { ...event, entityId: created.id, payload: created });
    return { row: created, created: true };
  }
  const [stored] = (await tx
    .select()
    .from(table as PgTable)
    .where(and(eq(table.id, values.id), eq(table.outletId, event.outletId)))) as T['$inferSelect'][];
  // An id taken at another outlet is not this request's retry: never hand that row back.
  if (!stored) throw new TRPCError({ code: 'CONFLICT', message: 'Id already used.' });
  return { row: stored, created: false };
};
