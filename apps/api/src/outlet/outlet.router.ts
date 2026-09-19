import { Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { canActOn, type Actor } from '../auth/rbac-rules';
import { OutletService, type OutletInput } from './outlet.service';
import type { StaffEntry } from './outlet-rules';

type Ctx = Actor & { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const outletOutput = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
});

const staffOutput = z.object({ id: z.string(), name: z.string(), username: z.string(), roleId: z.string() });

/** FORBIDDEN, not NOT_FOUND: hiding the outlet would tell a manager nothing they can act on. */
const wrongOutlet = () => new TRPCError({ code: 'FORBIDDEN', message: 'Wrong outlet.' });

@Router({ alias: 'outlet' })
export class OutletRouter {
  constructor(
    @Inject(OutletService) private readonly service: OutletService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(outletOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'outlet.view');
    return this.service.list();
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(60),
      code: z
        .string()
        .trim()
        .min(1)
        .max(12)
        .regex(/^[a-zA-Z0-9-]+$/),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(32).optional(),
    }),
    output: outletOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: OutletInput) {
    await this.rbac.require(ctx, 'outlet.manage');
    return this.service.create(input);
  }

  // The full field set, not a patch: this is a form save, so an omitted address clears it.
  @Mutation({
    input: z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(60),
      code: z
        .string()
        .trim()
        .min(1)
        .max(12)
        .regex(/^[a-zA-Z0-9-]+$/),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(32).optional(),
    }),
    output: outletOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: OutletInput & { id: string }) {
    await this.rbac.require(ctx, 'outlet.manage');
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }

  @Mutation({ input: z.object({ id: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async remove(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx, 'outlet.manage');
    return this.service.remove(id);
  }

  // Behind staff_assign, not view: a cashier needs the outlet list, not the roster of who else
  // works there. And only for the active outlet unless the role is global.
  @Query({ input: z.object({ outletId: z.uuid() }), output: z.array(staffOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async staff(@Ctx() ctx: Ctx, @Input('outletId') outletId: string) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, outletId)) throw wrongOutlet();
    return this.service.staff(outletId);
  }

  @Mutation({
    input: z.object({
      outletId: z.uuid(),
      staff: z.array(z.object({ userId: z.uuid(), roleId: z.uuid() })).max(200),
    }),
    output: z.array(staffOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setStaff(@Ctx() ctx: Ctx, @Input() input: { outletId: string; staff: StaffEntry[] }) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    return this.service.setStaff(input.outletId, input.staff);
  }
}
