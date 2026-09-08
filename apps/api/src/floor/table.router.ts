import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { TableService, type LayoutItem, type TableInput } from './table.service';

type Ctx = { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const tableOutput = z.object({
  id: z.string(),
  name: z.string(),
  seats: z.number(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  mergedIntoId: z.string().nullable(),
});

const layoutItem = z.object({
  id: z.string(),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(40).max(500),
  h: z.number().int().min(40).max(500),
});

@Router({ alias: 'table' })
export class TableRouter {
  constructor(
    @Inject(TableService) private readonly service: TableService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(tableOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx.user.id, 'table.view');
    return this.service.list();
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(20),
      seats: z.number().int().min(1).max(50),
      x: z.number().int().min(0).max(1000),
      y: z.number().int().min(0).max(1000),
      w: z.number().int().min(40).max(500),
      h: z.number().int().min(40).max(500),
    }),
    output: tableOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: TableInput) {
    await this.rbac.require(ctx.user.id, 'table.create');
    return this.service.create(input);
  }

  @Mutation({
    input: z.object({
      id: z.string(),
      name: z.string().trim().min(1).max(20),
      seats: z.number().int().min(1).max(50),
    }),
    output: tableOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: { id: string; name: string; seats: number }) {
    await this.rbac.require(ctx.user.id, 'table.layout_manage');
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }

  @Mutation({
    input: z.object({ items: z.array(layoutItem).min(1).max(200) }),
    output: z.array(tableOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async updateLayout(@Ctx() ctx: Ctx, @Input('items') items: LayoutItem[]) {
    await this.rbac.require(ctx.user.id, 'table.layout_manage');
    return this.service.updateLayout(items);
  }

  @Mutation({ input: z.object({ id: z.string() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx.user.id, 'table.delete');
    return this.service.delete(id);
  }

  @Mutation({
    input: z.object({ headId: z.string(), memberIds: z.array(z.string()).min(1).max(50) }),
    output: z.array(tableOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async merge(@Ctx() ctx: Ctx, @Input() input: { headId: string; memberIds: string[] }) {
    await this.rbac.require(ctx.user.id, 'table.merge');
    return this.service.merge(input.headId, input.memberIds);
  }

  @Mutation({ input: z.object({ id: z.string() }), output: z.array(tableOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async unmerge(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx.user.id, 'table.merge');
    return this.service.unmerge(id);
  }
}
