import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { outletStaff, outlets, permissions, rolePermissions, userPermissions, users } from '../db/schema';
import { Reason } from '../trpc/error-formatter';
import * as argon2 from 'argon2';
import { audit } from '../audit/audit';
import { lockedForMs, minutesLeft, reserveAttempt, resetAttempts } from './pin-check';
import { PIN_MAX_FAILURES, PIN_WINDOW_MS } from './pin-policy';
import {
  type Actor,
  type ApprovalInput,
  type Approved,
  type PermissionRow,
  effectivePermissions,
} from './rbac-rules';

/** FORBIDDEN, not UNAUTHORIZED: we know who this is, they just may not do this. */
export const forbidden = () => new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak memiliki akses.' });

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Lifts `userId`'s approval block early (US-010). The target must work at the caller's active outlet
   * (or the caller has a global role). Clearing and the audit row share one transaction; a user who is
   * not blocked is a no-op with no row. Nobody unblocks themselves.
   */
  async unblock(actor: Actor, userId: string): Promise<{ success: true }> {
    if (userId === actor.user.id)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Tidak bisa membuka blokir sendiri.' });
    const [target] = await this.db
      .select({ id: users.id })
      .from(users)
      .leftJoin(
        outletStaff,
        and(eq(outletStaff.userId, users.id), eq(outletStaff.outletId, actor.outletId ?? sql`null`)),
      )
      .where(
        and(
          eq(users.id, userId),
          isNull(users.deletedAt),
          actor.global ? sql`true` : isNotNull(outletStaff.userId),
        ),
      );
    if (!target) throw new TRPCError({ code: 'FORBIDDEN', message: 'Outlet tidak ditemukan.' });

    const remaining = await lockedForMs(this.db, userId, 'approval');
    if (remaining === 0) return { success: true };

    await this.db.transaction(async (tx) => {
      await resetAttempts(tx, userId, 'approval');
      await audit(tx, actor, {
        outletId: actor.outletId,
        module: 'approval',
        action: 'approval.unblocked',
        entityType: 'user',
        entityId: userId,
        before: { blockedUntil: new Date(Date.now() + remaining).toISOString() },
        after: { blockedUntil: null },
      });
    });
    return { success: true };
  }

  /**
   * Where each permission comes from: the user's role at `outletId` (`users.role_id` when set —
   * global, owner — otherwise the `outlet_staff` row for that outlet), plus their overrides at that
   * outlet. An override counts only while the user is a member of a live outlet, so a stale grant
   * cannot outlive a removal. No outlet: no overrides, and role rows for a global role only.
   */
  async rowsOf(userId: string, outletId: string | null): Promise<PermissionRow[]> {
    // `sql\`false\`` keeps the join shape identical when there is no outlet to match: the left join
    // yields nulls, coalesce falls through to users.role_id, and a scoped user gets nothing.
    const membership = outletId
      ? and(
          eq(outletStaff.outletId, outletId),
          // A closed outlet grants nothing, even to a token minted before it closed.
          sql`exists (select 1 from ${outlets} where ${outlets.id} = ${outletStaff.outletId} and ${outlets.deletedAt} is null)`,
        )
      : sql`false`;
    const roleId = sql`coalesce(${users.roleId}, ${outletStaff.roleId})`;

    const fromRole = this.db
      .select({ name: permissions.name, source: sql<PermissionRow['source']>`'role'` })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), membership))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(users.id, userId));

    const fromOverrides = this.db
      .select({
        name: permissions.name,
        // The stored effect *is* the source tag: 'grant' and 'revoke' need no mapping.
        source: sql<PermissionRow['source']>`${userPermissions.effect}`,
      })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(
        and(
          eq(userPermissions.userId, userId),
          outletId
            ? and(
                eq(userPermissions.outletId, outletId),
                sql`exists (select 1 from ${outletStaff} join ${outlets} on ${outlets.id} = ${outletStaff.outletId} where ${outletStaff.userId} = ${userPermissions.userId} and ${outletStaff.outletId} = ${userPermissions.outletId} and ${outlets.deletedAt} is null)`,
              )
            : sql`false`,
        ),
      );

    return unionAll(fromRole, fromOverrides);
  }

  /** What the user holds at `outletId`: role grants plus grants, minus revokes. One round trip: `require` runs on every gated call. */
  async permissionsOf(userId: string, outletId: string | null): Promise<string[]> {
    return effectivePermissions(await this.rowsOf(userId, outletId));
  }

  async require(actor: Actor, permission: string): Promise<void> {
    const held = await this.permissionsOf(actor.user.id, actor.outletId);
    if (!held.includes(permission)) throw forbidden();
  }

  /**
   * `require` with a way past the refusal (US-010): a manager who holds `permission` and
   * `approval.grant` at the caller's outlet approves this one call with their PIN. The action still runs
   * as the caller; the result is what the service audits. Null = the caller holds the permission.
   *
   * Wrong PINs count against the CALLER, never the approver: five within ten minutes block this caller
   * from every override for ten (audited as `approval.blocked`), while other staff keep using the same
   * manager. A right PIN is neutral: it refunds its own attempt and never clears earlier failures.
   * Every refusal is FORBIDDEN except wrong digits (UNAUTHORIZED + INVALID_PIN).
   */
  async requireOrApprove(
    actor: Actor,
    permission: string,
    approval?: ApprovalInput,
  ): Promise<Approved | null> {
    if ((await this.permissionsOf(actor.user.id, actor.outletId)).includes(permission)) return null;
    if (!approval)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Anda tidak memiliki akses.',
        cause: new Reason('NEEDS_APPROVAL'),
      });

    const blocked = async () =>
      new TRPCError({
        code: 'FORBIDDEN',
        message: `Akses diblokir. Minta manajer membuka blokir, atau coba lagi dalam ${minutesLeft(await lockedForMs(this.db, actor.user.id, 'approval'))} menit.`,
      });
    if ((await lockedForMs(this.db, actor.user.id, 'approval')) > 0) throw await blocked();

    const [approver] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, approval.approverUserId), isNull(users.deletedAt)));
    const held = approver ? await this.permissionsOf(approver.id, actor.outletId) : [];
    if (!approver || !held.includes(permission) || !held.includes('approval.grant'))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Penyetuju tidak memiliki akses.' });
    if (!approver.pinHash) throw new TRPCError({ code: 'FORBIDDEN', message: 'Penyetuju belum punya PIN.' });

    const attempt = await reserveAttempt(this.db, actor.user.id, 'approval');
    if (!attempt) throw await blocked();

    if (await argon2.verify(approver.pinHash, approval.pin)) {
      // Refund only this attempt's reservation; earlier failures stay. Skipped if a concurrent attempt
      // moved the counter (errs toward blocking). Compare failures only: JS Date drops microseconds.
      await this.db
        .update(users)
        .set({ approvalFailures: attempt.failures - 1 })
        .where(and(eq(users.id, actor.user.id), eq(users.approvalFailures, attempt.failures)));
      return { actor, permission, approverUserId: approver.id, reason: approval.reason };
    }

    if (attempt.failures >= PIN_MAX_FAILURES) {
      // Not inside any action's transaction: the action did not run, the block did happen.
      await audit(this.db, actor, {
        outletId: actor.outletId,
        module: 'approval',
        action: 'approval.blocked',
        entityType: 'user',
        entityId: actor.user.id,
        after: {
          blockedUntil: new Date(attempt.windowStartedAt.getTime() + PIN_WINDOW_MS).toISOString(),
          permission,
          approverUserId: approver.id,
        },
      });
      throw new TRPCError({ code: 'FORBIDDEN', message: 'PIN salah 5 kali. Akses diblokir 10 menit.' });
    }
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'PIN tidak cocok.',
      cause: new Reason('INVALID_PIN'),
    });
  }

  /**
   * Who could approve `permission` for this caller right now, for the "Minta akses" picker:
   * live users with a PIN who hold it and `approval.grant` at the caller's outlet — its staff plus
   * the global roles — minus the caller.
   *
   * ponytail: one `permissionsOf` per candidate; an outlet roster is tens of people. One grouped
   * query if it ever shows in traces.
   */
  async approvers(actor: Actor, permission: string): Promise<{ id: string; name: string }[]> {
    if (!actor.outletId) return [];
    const candidates = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), eq(outletStaff.outletId, actor.outletId)))
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.pinHash),
          ne(users.id, actor.user.id),
          or(isNotNull(users.roleId), isNotNull(outletStaff.userId)),
        ),
      )
      .orderBy(asc(users.name));
    const held = await Promise.all(candidates.map((c) => this.permissionsOf(c.id, actor.outletId)));
    return candidates.filter((_, i) => held[i]!.includes(permission) && held[i]!.includes('approval.grant'));
  }
}
