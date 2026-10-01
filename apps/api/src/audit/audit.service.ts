import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { type AuditModule, auditLog, outlets, users } from '../db/schema';

export interface AuditQuery {
  outletId: string;
  /** Outlet-local calendar days, `YYYY-MM-DD`, both inclusive. */
  fromDate: string;
  toDate: string;
  module?: AuditModule;
  /** As actor or as approver. */
  userId?: string;
  /** `nextCursor` from the previous page. */
  cursor?: { createdAt: string; id: string };
}

export interface AuditRow {
  id: string;
  createdAt: string;
  module: AuditModule;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorName: string;
  approverName: string | null;
}

const PAGE = 50;
const approvers = alias(users, 'approvers');

@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Newest first, keyset-paged on `(created_at, id)`, so a row written while someone pages never
   * shifts the next page. `global` adds the deployment-wide rows (app settings), which belong to no
   * outlet and only a global role may read.
   */
  async list(
    q: AuditQuery,
    global: boolean,
  ): Promise<{ rows: AuditRow[]; nextCursor: AuditQuery['cursor'] | null }> {
    // The outlet's own calendar day: 1 Oct in WITA is not 1 Oct in WIB.
    const tz = sql`(select ${outlets.timezone} from ${outlets} where ${outlets.id} = ${q.outletId})`;
    const rows = await this.db
      .select({
        id: auditLog.id,
        // Text, not a Date: Postgres keeps microseconds, a JS Date would round them off and the
        // cursor would skip or repeat rows written in the same millisecond.
        at: sql<string>`${auditLog.createdAt}::text`,
        createdAt: auditLog.createdAt,
        module: auditLog.module,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
        before: auditLog.before,
        after: auditLog.after,
        actorName: users.name,
        approverName: approvers.name,
      })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(approvers, eq(approvers.id, auditLog.approverUserId))
      .where(
        and(
          or(eq(auditLog.outletId, q.outletId), global ? isNull(auditLog.outletId) : undefined),
          sql`${auditLog.createdAt} >= (${q.fromDate}::date)::timestamp at time zone ${tz}`,
          sql`${auditLog.createdAt} < (${q.toDate}::date + 1)::timestamp at time zone ${tz}`,
          q.module ? eq(auditLog.module, q.module) : undefined,
          q.userId
            ? or(eq(auditLog.actorUserId, q.userId), eq(auditLog.approverUserId, q.userId))
            : undefined,
          q.cursor
            ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${q.cursor.createdAt}::timestamptz, ${q.cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(PAGE + 1);

    const page = rows.slice(0, PAGE);
    const last = page.at(-1);
    return {
      // `at` rides along and is dropped by the router's output schema.
      rows: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: rows.length > PAGE && last ? { createdAt: last.at, id: last.id } : null,
    };
  }

  /** Everyone who appears in this outlet's log, as actor or approver: the user filter's choices. */
  async actors(outletId: string, global: boolean): Promise<{ id: string; name: string }[]> {
    return this.db
      .selectDistinct({ id: users.id, name: users.name })
      .from(auditLog)
      .innerJoin(users, or(eq(users.id, auditLog.actorUserId), eq(users.id, auditLog.approverUserId)))
      .where(or(eq(auditLog.outletId, outletId), global ? isNull(auditLog.outletId) : undefined))
      .orderBy(users.name);
  }
}
