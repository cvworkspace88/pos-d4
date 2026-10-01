import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeOutlet } from '../auth/active-outlet';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { Actor } from '../auth/rbac-rules';
import { CategoryService, type CategoryInput } from './category.service';

type Ctx = Actor & { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const categoryOutput = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  color: z.string().nullable(),
  active: z.boolean(),
  kitchenStationId: z.string().nullable(),
});
// Written out, not `categoryOutput.extend(...)`: the generator cannot hoist a schema built from another.
const categoryListOutput = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  color: z.string().nullable(),
  active: z.boolean(),
  kitchenStationId: z.string().nullable(),
  // Live menu items in the category.
  itemCount: z.number().int(),
});

/** The active outlet's menu categories. Each outlet has its own menu (US-013). */
@Router({ alias: 'category' })
export class CategoryRouter {
  constructor(
    @Inject(CategoryService) private readonly service: CategoryService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(categoryListOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'category.view');
    return this.service.list(activeOutlet(ctx));
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(40),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .optional(),
    }),
    output: categoryOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: { name: string; color?: string | null }) {
    await this.rbac.require(ctx, 'category.edit');
    return this.service.create(activeOutlet(ctx), input.name, input.color ?? null);
  }

  // The full field set, not a patch: this is a form save.
  @Mutation({
    input: z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(40),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
      active: z.boolean(),
      kitchenStationId: z.uuid().nullable(),
    }),
    output: categoryOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: CategoryInput & { id: string }) {
    await this.rbac.require(ctx, 'category.edit');
    const { id, ...fields } = input;
    return this.service.update(activeOutlet(ctx), id, fields);
  }

  @Mutation({ input: z.object({ id: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx, 'category.edit');
    return this.service.delete(activeOutlet(ctx), id);
  }

  @Mutation({
    input: z.object({ ids: z.array(z.uuid()).max(200) }),
    output: z.array(categoryOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async reorder(@Ctx() ctx: Ctx, @Input('ids') ids: string[]) {
    await this.rbac.require(ctx, 'category.edit');
    return this.service.reorder(activeOutlet(ctx), ids);
  }
}
