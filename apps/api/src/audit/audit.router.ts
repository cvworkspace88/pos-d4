import { Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { canActOn, type Actor } from '../auth/rbac-rules';
import { AuditService, type AuditQuery } from './audit.service';

type Ctx = Actor & { user: PublicUser };

// The generator hoists these into the shared contract. The module list is a literal on purpose: it
// cannot hoist an identifier a schema references. Keep it in step with `AUDIT_MODULES`.
const auditRowOutput = z.object({
  id: z.string(),
  createdAt: z.string(),
  module: z.enum(['settings', 'outlet', 'staff', 'category', 'menu', 'addon', 'role']),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  actorName: z.string(),
  approverName: z.string().nullable(),
});

/** Same refusal as the outlet router: reads like NOT_FOUND, stays FORBIDDEN. */
const wrongOutlet = () => new TRPCError({ code: 'FORBIDDEN', message: 'Outlet tidak ditemukan.' });

/** The audit log (US-011). Read-only: rows are written by `audit()` inside each service's transaction. */
@Router({ alias: 'audit' })
export class AuditRouter {
  constructor(
    @Inject(AuditService) private readonly service: AuditService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({
    input: z.object({
      outletId: z.uuid(),
      fromDate: z.iso.date(),
      toDate: z.iso.date(),
      module: z.enum(['settings', 'outlet', 'staff', 'category', 'menu', 'addon', 'role']).optional(),
      userId: z.uuid().optional(),
      cursor: z.object({ createdAt: z.string().max(40), id: z.uuid() }).optional(),
    }),
    output: z.object({
      rows: z.array(auditRowOutput),
      nextCursor: z.object({ createdAt: z.string(), id: z.string() }).nullable(),
    }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx, @Input() input: AuditQuery) {
    await this.rbac.require(ctx, 'report.view_audit');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    if (input.toDate < input.fromDate)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal akhir sebelum tanggal awal.' });
    return this.service.list(input, ctx.global);
  }

  @Query({
    input: z.object({ outletId: z.uuid() }),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async actors(@Ctx() ctx: Ctx, @Input('outletId') outletId: string) {
    await this.rbac.require(ctx, 'report.view_audit');
    if (!canActOn(ctx, outletId)) throw wrongOutlet();
    return this.service.actors(outletId, ctx.global);
  }
}
