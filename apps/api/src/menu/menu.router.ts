import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeOutlet } from '../auth/active-outlet';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService, forbidden } from '../auth/rbac.service';
import type { Actor } from '../auth/rbac-rules';
import { forViewer } from './menu-rules';
import { MenuService, type MenuItemInput } from './menu.service';

type Ctx = Actor & { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const menuItemOutput = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  kitchenName: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  // With variants: the lowest variant price, for display only.
  price: z.number().int(),
  // Null when not entered, when the item has variants - and always null for a caller without `menu.manage`.
  cost: z.number().int().nullable(),
  tax: z.enum(['pbjt', 'ppn', 'none']),
  // The item's own station (null: inherits) and the resolved one a line would route to.
  kitchenStationId: z.string().nullable(),
  stationId: z.string().nullable(),
  soldBy: z.enum(['unit', 'weight']),
  sortOrder: z.number().int(),
  active: z.boolean(),
  variants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number().int(),
      cost: z.number().int().nullable(),
      available: z.boolean(),
    }),
  ),
  addonGroupIds: z.array(z.string()),
});

/** The active outlet's menu. Each outlet has its own (US-013); sold-out arrives with US-018. */
@Router({ alias: 'menu' })
export class MenuRouter {
  constructor(
    @Inject(MenuService) private readonly service: MenuService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /**
   * Categories, items and add-on groups in one call. One permission read answers both questions -
   * may you read, and may you see cost - hence no `require`.
   */
  @Query({
    output: z.object({
      categories: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          sortOrder: z.number().int(),
          color: z.string().nullable(),
          active: z.boolean(),
          kitchenStationId: z.string().nullable(),
          itemCount: z.number().int(),
        }),
      ),
      items: z.array(menuItemOutput),
      addonGroups: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          minSelect: z.number().int(),
          maxSelect: z.number().int(),
          options: z.array(
            z.object({ id: z.string(), name: z.string(), price: z.number().int(), available: z.boolean() }),
          ),
          usedBy: z.number().int(),
        }),
      ),
    }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    const held = await this.rbac.permissionsOf(ctx.user.id, ctx.outletId);
    if (!held.includes('menu.view')) throw forbidden();
    const menu = await this.service.list(activeOutlet(ctx));
    return { ...menu, items: forViewer(menu.items, held) };
  }

  /** Rates in basis points, for the form to show beside each tax. PBJT is the active outlet's. */
  @Query({ output: z.object({ pbjtRateBp: z.number().int(), ppnRateBp: z.number().int() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async taxRates(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx, 'menu.view');
    return this.service.taxRates(activeOutlet(ctx));
  }

  @Mutation({
    input: z.object({
      categoryId: z.uuid(),
      code: z
        .string()
        .trim()
        .max(20)
        .regex(/^[A-Za-z0-9-]*$/)
        .nullable(),
      name: z.string().trim().min(1).max(60),
      kitchenName: z.string().trim().min(1).max(60).nullable(),
      description: z.string().trim().min(1).max(500).nullable(),
      imageUrl: z
        .url({ protocol: /^https?$/ })
        .max(500)
        .nullable(),
      price: z.number().int().min(0).max(100000000),
      cost: z.number().int().min(0).max(100000000).nullable(),
      tax: z.enum(['pbjt', 'ppn', 'none']),
      kitchenStationId: z.uuid().nullable(),
      soldBy: z.enum(['unit', 'weight']),
      active: z.boolean(),
      variants: z
        .array(
          z.object({
            id: z.uuid().optional(),
            name: z.string().trim().min(1).max(60),
            price: z.number().int().min(0).max(100000000),
            cost: z.number().int().min(0).max(100000000).nullable(),
            available: z.boolean(),
          }),
        )
        .max(30),
      addonGroupIds: z.array(z.uuid()).max(20),
    }),
    output: menuItemOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: MenuItemInput) {
    await this.rbac.require(ctx, 'menu.manage');
    return this.service.create(activeOutlet(ctx), input);
  }

  @Mutation({
    input: z.object({
      id: z.uuid(),
      categoryId: z.uuid(),
      code: z
        .string()
        .trim()
        .max(20)
        .regex(/^[A-Za-z0-9-]*$/)
        .nullable(),
      name: z.string().trim().min(1).max(60),
      kitchenName: z.string().trim().min(1).max(60).nullable(),
      description: z.string().trim().min(1).max(500).nullable(),
      imageUrl: z
        .url({ protocol: /^https?$/ })
        .max(500)
        .nullable(),
      price: z.number().int().min(0).max(100000000),
      cost: z.number().int().min(0).max(100000000).nullable(),
      tax: z.enum(['pbjt', 'ppn', 'none']),
      kitchenStationId: z.uuid().nullable(),
      soldBy: z.enum(['unit', 'weight']),
      active: z.boolean(),
      variants: z
        .array(
          z.object({
            id: z.uuid().optional(),
            name: z.string().trim().min(1).max(60),
            price: z.number().int().min(0).max(100000000),
            cost: z.number().int().min(0).max(100000000).nullable(),
            available: z.boolean(),
          }),
        )
        .max(30),
      addonGroupIds: z.array(z.uuid()).max(20),
    }),
    output: menuItemOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: MenuItemInput & { id: string }) {
    await this.rbac.require(ctx, 'menu.manage');
    const { id, ...fields } = input;
    return this.service.update(activeOutlet(ctx), id, fields);
  }

  @Mutation({
    input: z.object({ id: z.uuid(), active: z.boolean() }),
    output: z.object({ id: z.string(), active: z.boolean() }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setActive(@Ctx() ctx: Ctx, @Input() input: { id: string; active: boolean }) {
    await this.rbac.require(ctx, 'menu.manage');
    return this.service.setActive(activeOutlet(ctx), input.id, input.active);
  }

  @Mutation({ input: z.object({ id: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx, 'menu.manage');
    return this.service.delete(activeOutlet(ctx), id);
  }
}
