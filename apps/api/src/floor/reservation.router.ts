import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { activeOutlet } from '../auth/active-outlet';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { Actor, ApprovalInput } from '../auth/rbac-rules';
import { ReservationService, type ReservationInput, type ReservationPatch } from './reservation.service';

type Ctx = Actor & { user: PublicUser };

const reservationOutput = z.object({
  id: z.string(),
  tableId: z.string(),
  customerName: z.string(),
  phone: z.string().nullable(),
  partySize: z.number(),
  startsAt: z.string(),
  note: z.string().nullable(),
  status: z.enum(['booked', 'seated', 'cancelled', 'no_show']),
});

@Router({ alias: 'reservation' })
export class ReservationRouter {
  constructor(
    @Inject(ReservationService) private readonly service: ReservationService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({
    input: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }),
    output: z.array(reservationOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx, @Input() input: { from: string; to: string }) {
    await this.rbac.require(ctx, 'reservation.view');
    return this.service.list(activeOutlet(ctx), input.from, input.to);
  }

  @Mutation({
    input: z.object({
      id: z.uuid(),
      tableId: z.uuid(),
      customerName: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100),
      startsAt: z.iso.datetime({ offset: true }),
      note: z.string().trim().max(500).optional(),
      approval: z
        .object({
          approverUserId: z.uuid(),
          pin: z.string().regex(/^\d{6}$/),
          reason: z.string().trim().max(200).optional(),
        })
        .optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: ReservationInput & { id: string; approval?: ApprovalInput }) {
    const { approval, ...fields } = input;
    const approved = await this.rbac.requireOrApprove(ctx, 'reservation.create', approval);
    return this.service.create(ctx, activeOutlet(ctx), fields, approved);
  }

  @Mutation({
    input: z.object({
      id: z.uuid(),
      status: z.enum(['seated', 'cancelled', 'no_show']).optional(),
      tableId: z.uuid().optional(),
      customerName: z.string().trim().min(1).max(80).optional(),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100).optional(),
      startsAt: z.iso.datetime({ offset: true }).optional(),
      note: z.string().trim().max(500).optional(),
      approval: z
        .object({
          approverUserId: z.uuid(),
          pin: z.string().regex(/^\d{6}$/),
          reason: z.string().trim().max(200).optional(),
        })
        .optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: { id: string; approval?: ApprovalInput } & ReservationPatch) {
    const { id, approval, ...patch } = input;
    const approved = await this.rbac.requireOrApprove(ctx, 'reservation.update', approval);
    return this.service.update(ctx, activeOutlet(ctx), id, patch, approved);
  }
}
