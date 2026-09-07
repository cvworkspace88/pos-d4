import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { PublicUser } from '../auth/auth.service';
import { SettingsService } from './settings.service';

@Router({ alias: 'settings' })
export class SettingsRouter {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Any signed-in user may read: tablets need the idle timeout to enforce it. */
  @Query({ output: z.object({ idleTimeoutSeconds: z.number() }) })
  @UseMiddlewares(ProtectedMiddleware)
  get() {
    return this.settings.get();
  }

  @Mutation({
    input: z.object({ idleTimeoutSeconds: z.number().int().min(30).max(3600) }),
    output: z.object({ idleTimeoutSeconds: z.number() }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: { user: PublicUser }, @Input() input: { idleTimeoutSeconds: number }) {
    await this.rbac.require(ctx.user.id, 'settings.manage');
    return this.settings.update(input);
  }
}
