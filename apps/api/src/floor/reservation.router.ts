import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import {
  ReservationService,
  type ReservationInput,
  type ReservationPatch,
} from './reservation.service';

type Ctx = { user: PublicUser };

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
    await this.rbac.require(ctx.user.id, 'reservation.view');
    return this.service.list(input.from, input.to);
  }

  @Mutation({
    input: z.object({
      tableId: z.string(),
      customerName: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100),
      startsAt: z.iso.datetime({ offset: true }),
      note: z.string().trim().max(500).optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: ReservationInput) {
    await this.rbac.require(ctx.user.id, 'reservation.create');
    return this.service.create(ctx.user.id, input);
  }

  @Mutation({
    input: z.object({
      id: z.string(),
      status: z.enum(['seated', 'cancelled', 'no_show']).optional(),
      tableId: z.string().optional(),
      customerName: z.string().trim().min(1).max(80).optional(),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100).optional(),
      startsAt: z.iso.datetime({ offset: true }).optional(),
      note: z.string().trim().max(500).optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: { id: string } & ReservationPatch) {
    await this.rbac.require(ctx.user.id, 'reservation.update');
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }
}
