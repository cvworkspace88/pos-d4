import { Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { canActOn, type Actor } from '../auth/rbac-rules';
import { OutletService, type NewStaffInput, type OutletDetails, type OutletInput } from './outlet.service';
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
  active: z.boolean(),
});

const staffOutput = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  roleId: z.string(),
  roleName: z.string(),
  global: z.boolean(),
});

/**
 * Reads like NOT_FOUND, so it does not confirm an outlet the caller may not see — but stays FORBIDDEN
 * in code: a client refetching on NOT_FOUND would loop, and 403 is the honest status.
 */
const wrongOutlet = () =>
  new TRPCError({
    code: 'FORBIDDEN',
    message: 'Outlet tidak ditemukan.',
  });

@Router({ alias: 'outlet' })
export class OutletRouter {
  constructor(
    @Inject(OutletService) private readonly service: OutletService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(outletOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'outlet.view_all');
    return this.service.list();
  }

  /**
   * One outlet, the caller's own. No permission: the session already carries which outlets you
   * work at, so its address and phone are not a privilege on top — same call shape as
   * `settings.get`. `canActOn` is what keeps it to your own.
   */
  @Query({ input: z.object({ id: z.uuid() }), output: outletOutput })
  @UseMiddlewares(ProtectedMiddleware)
  async get(@Ctx() ctx: Ctx, @Input('id') id: string) {
    if (!canActOn(ctx, id)) throw wrongOutlet();
    return this.service.get(id);
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
    await this.rbac.require(ctx, 'outlet.create');
    return this.service.create(input);
  }

  // The full field set, not a patch: this is a form save, so an omitted address clears it. The
  // code is not part of it — see `setCode`.
  @Mutation({
    input: z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(60),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(32).optional(),
    }),
    output: outletOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: OutletDetails & { id: string }) {
    await this.rbac.require(ctx, 'outlet.manage');
    if (!canActOn(ctx, input.id)) throw wrongOutlet();
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }

  /**
   * The code on its own, not part of the detail form: it is printed on receipts and keys terminal
   * setup, so changing it is a deliberate act. Same permission and same confinement as `update`.
   */
  @Mutation({
    input: z.object({
      id: z.uuid(),
      code: z
        .string()
        .trim()
        .min(1)
        .max(12)
        .regex(/^[a-zA-Z0-9-]+$/),
    }),
    output: outletOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setCode(@Ctx() ctx: Ctx, @Input() input: { id: string; code: string }) {
    await this.rbac.require(ctx, 'outlet.manage');
    if (!canActOn(ctx, input.id)) throw wrongOutlet();
    return this.service.setCode(input.id, input.code);
  }

  /**
   * Deactivate or reactivate. Behind `outlet.delete`, the permission the old `remove` used: taking
   * an outlet out of service is a decision about the set of outlets, so there is no `canActOn`
   * confinement to the session's own outlet.
   */
  @Mutation({ input: z.object({ id: z.uuid(), active: z.boolean() }), output: outletOutput })
  @UseMiddlewares(ProtectedMiddleware)
  async setActive(@Ctx() ctx: Ctx, @Input() input: { id: string; active: boolean }) {
    await this.rbac.require(ctx, 'outlet.delete');
    return this.service.setActive(input.id, input.active);
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

  /**
   * What the roster screen may pick from — and, by omission, which lines it may touch: manager only
   * appears for a global role. Same gate as `setStaff`, the only call that takes these ids.
   */
  @Query({ output: z.array(z.object({ id: z.string(), name: z.string() })) })
  @UseMiddlewares(ProtectedMiddleware)
  async roles(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    return this.service.assignableRoles(ctx);
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
    return this.service.setStaff(input.outletId, input.staff, ctx);
  }

  /** Accounts `setStaff` could add here, by username prefix. Same gate and confinement as `setStaff`. */
  @Query({
    input: z.object({ outletId: z.uuid(), username: z.string().trim().min(1).max(32) }),
    output: z.array(z.object({ id: z.string(), name: z.string(), username: z.string() })),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async findUsers(@Ctx() ctx: Ctx, @Input() input: { outletId: string; username: string }) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    return this.service.findUsers(input.outletId, input.username);
  }

  /** A new account, straight onto this outlet's roster. Same gate and confinement as `setStaff`. */
  @Mutation({
    input: z.object({
      outletId: z.uuid(),
      name: z.string().trim().min(2).max(80),
      username: z.string().trim().min(3).max(32),
      password: z.string().min(8).max(128),
      pin: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
      roleId: z.uuid(),
    }),
    output: z.array(staffOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async addStaff(@Ctx() ctx: Ctx, @Input() input: NewStaffInput & { outletId: string }) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    const { outletId, ...staff } = input;
    return this.service.addStaff(outletId, staff, ctx);
  }
}
