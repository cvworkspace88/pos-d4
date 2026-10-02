import { Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { canActOn, type Actor } from '../auth/rbac-rules';
import { RoleService, type OverrideInput, type RoleInput } from './role.service';

type Ctx = Actor & { user: PublicUser };

/** Same refusal as the outlet router: reads like NOT_FOUND, stays FORBIDDEN. */
const wrongOutlet = () => new TRPCError({ code: 'FORBIDDEN', message: 'Outlet tidak ditemukan.' });

@Router({ alias: 'role' })
export class RoleRouter {
  constructor(
    @Inject(RoleService) private readonly service: RoleService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Every role against every permission. Base roles are locked (`editable: false`); custom roles are not. */
  @Query({
    output: z.object({
      roles: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          isGlobal: z.boolean(),
          editable: z.boolean(),
          permissionCount: z.number(),
        }),
      ),
      groups: z.array(
        z.object({
          domain: z.string(),
          rows: z.array(
            z.object({
              key: z.string(),
              description: z.string().nullable(),
              granted: z.array(z.boolean()),
            }),
          ),
        }),
      ),
    }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async matrix(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'role.view');
    return this.service.matrix();
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(200).nullable(),
      permissions: z.array(z.string().max(60)).max(200),
    }),
    output: z.object({ id: z.string() }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: RoleInput) {
    await this.rbac.require(ctx, 'role.manage');
    return this.service.create(input, ctx);
  }

  @Mutation({
    input: z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(200).nullable(),
      permissions: z.array(z.string().max(60)).max(200),
    }),
    output: z.object({ success: z.boolean() }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() { id, ...input }: RoleInput & { id: string }) {
    await this.rbac.require(ctx, 'role.manage');
    return this.service.update(id, input, ctx);
  }

  @Mutation({ input: z.object({ id: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx, 'role.manage');
    return this.service.delete(id, ctx);
  }

  /** The override editor for one person at one outlet. */
  @Query({
    input: z.object({ userId: z.uuid(), outletId: z.uuid() }),
    output: z.array(
      z.object({
        permission: z.string(),
        fromRole: z.boolean(),
        override: z.enum(['grant', 'revoke']).nullable(),
        effective: z.boolean(),
      }),
    ),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async userPermissions(@Ctx() ctx: Ctx, @Input() input: { userId: string; outletId: string }) {
    await this.rbac.require(ctx, 'permission.override');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    return this.service.userPermissions(input.userId, input.outletId);
  }

  /** Grant, revoke or clear (`effect: null`) one permission for one person at each outlet ticked. */
  @Mutation({
    input: z.object({
      userId: z.uuid(),
      outletIds: z.array(z.uuid()).min(1).max(50),
      permission: z.string().max(60),
      effect: z.enum(['grant', 'revoke']).nullable(),
    }),
    output: z.object({ success: z.boolean() }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setOverride(@Ctx() ctx: Ctx, @Input() input: OverrideInput) {
    await this.rbac.require(ctx, 'permission.override');
    if (!input.outletIds.every((outletId) => canActOn(ctx, outletId))) throw wrongOutlet();
    return this.service.setOverride(input, ctx);
  }
}
