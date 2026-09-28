import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeOutlet } from '../auth/active-outlet';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { Actor } from '../auth/rbac-rules';
import { CategoryService } from './category.service';

type Ctx = Actor & { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const categoryOutput = z.object({ id: z.string(), name: z.string(), sortOrder: z.number().int() });

@Router({ alias: 'category' })
export class CategoryRouter {
  constructor(
    @Inject(CategoryService) private readonly service: CategoryService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(categoryOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'category.view');
    return this.service.list(activeOutlet(ctx));
  }

  @Mutation({ input: z.object({ name: z.string().trim().min(1).max(40) }), output: categoryOutput })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input('name') name: string) {
    await this.rbac.require(ctx, 'category.edit');
    return this.service.create(activeOutlet(ctx), name);
  }

  @Mutation({
    input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(40) }),
    output: categoryOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async rename(@Ctx() ctx: Ctx, @Input() input: { id: string; name: string }) {
    await this.rbac.require(ctx, 'category.edit');
    return this.service.rename(activeOutlet(ctx), input.id, input.name);
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
