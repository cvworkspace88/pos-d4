import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeOutlet } from '../auth/active-outlet';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { Actor } from '../auth/rbac-rules';
import { AddonService, type AddonGroupInput } from './addon.service';

type Ctx = Actor & { user: PublicUser };

// Hoisted by the generator. Options are nested inline: it cannot hoist a schema another one references.
const groupOutput = z.object({
  id: z.string(),
  name: z.string(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  options: z.array(
    z.object({ id: z.string(), name: z.string(), price: z.number().int(), available: z.boolean() }),
  ),
  usedBy: z.number().int(),
});

/** Shared add-on groups of the active outlet. Menu data: `menu.view` reads, `menu.manage` writes. */
@Router({ alias: 'addon' })
export class AddonRouter {
  constructor(
    @Inject(AddonService) private readonly service: AddonService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(groupOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'menu.view');
    return this.service.list(activeOutlet(ctx));
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(60),
      minSelect: z.number().int().min(0).max(50),
      maxSelect: z.number().int().min(1).max(50),
      options: z
        .array(
          z.object({
            id: z.uuid().optional(),
            name: z.string().trim().min(1).max(60),
            price: z.number().int().min(0).max(100000000),
            available: z.boolean(),
          }),
        )
        .min(1)
        .max(50),
    }),
    output: groupOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: AddonGroupInput) {
    await this.rbac.require(ctx, 'menu.manage');
    return this.service.create(ctx, activeOutlet(ctx), input);
  }

  // The full field set, not a patch: this is a form save.
  @Mutation({
    input: z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(60),
      minSelect: z.number().int().min(0).max(50),
      maxSelect: z.number().int().min(1).max(50),
      options: z
        .array(
          z.object({
            id: z.uuid().optional(),
            name: z.string().trim().min(1).max(60),
            price: z.number().int().min(0).max(100000000),
            available: z.boolean(),
          }),
        )
        .min(1)
        .max(50),
    }),
    output: groupOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: AddonGroupInput & { id: string }) {
    await this.rbac.require(ctx, 'menu.manage');
    const { id, ...fields } = input;
    return this.service.update(ctx, activeOutlet(ctx), id, fields);
  }

  @Mutation({ input: z.object({ id: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx, 'menu.manage');
    return this.service.delete(ctx, activeOutlet(ctx), id);
  }
}
