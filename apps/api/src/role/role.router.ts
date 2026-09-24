import { Inject } from '@nestjs/common';
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { Actor } from '../auth/rbac-rules';
import { RoleService } from './role.service';

@Router({ alias: 'role' })
export class RoleRouter {
  constructor(
    @Inject(RoleService) private readonly service: RoleService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Read-only: the seed owns the built-in roles' grants, so there is nothing here to edit yet. */
  @Query({
    output: z.object({
      roles: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
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
  async matrix(@Ctx() ctx: Actor & { user: PublicUser }) {
    await this.rbac.require(ctx, 'role.view');
    return this.service.matrix();
  }
}
