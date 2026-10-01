import type { Tx } from '../db/db.module';
import { type AuditModule, auditLog } from '../db/schema';
import type { Actor } from '../auth/rbac-rules';
import { type Snapshot, auditDiff } from './audit-rules';

export type AuditEntry<M extends AuditModule> = {
  /** Null = a deployment-wide change (app settings). */
  outletId: string | null;
  module: M;
  action: `${M}.${string}`;
  entityType: string;
  entityId: string | null;
  before?: Snapshot;
  after?: Snapshot;
  reason?: string;
};

/**
 * Records one change. Call it with the transaction that makes the change, so the row commits or
 * rolls back with it — never a change without its audit row, never an audit row for a change that
 * did not happen. Writes nothing when nothing changed.
 */
export const audit = async <M extends AuditModule>(
  db: Pick<Tx, 'insert'>,
  actor: Actor,
  entry: AuditEntry<M>,
): Promise<void> => {
  const diff = auditDiff(entry.before, entry.after);
  if (!diff) return;
  await db.insert(auditLog).values({
    outletId: entry.outletId,
    actorUserId: actor.user.id,
    module: entry.module,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    ...diff,
  });
};
