import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { PublicUser } from '../auth/auth.service';
import type { Actor } from '../auth/rbac-rules';
import { SettingsService } from './settings.service';

const settingsOutput = z.object({ idleTimeoutSeconds: z.number(), ppnRateBp: z.number().int() });

@Router({ alias: 'settings' })
export class SettingsRouter {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Any signed-in user may read: tablets need the idle timeout, and tills will need the PPN rate. */
  @Query({ output: settingsOutput })
  @UseMiddlewares(ProtectedMiddleware)
  get() {
    return this.settings.get();
  }

  @Mutation({
    input: z.object({ idleTimeoutSeconds: z.number().int().min(30).max(3600) }),
    output: settingsOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Actor & { user: PublicUser }, @Input() input: { idleTimeoutSeconds: number }) {
    await this.rbac.require(ctx, 'settings.manage');
    return this.settings.update(input);
  }

  /** Its own call rather than a field on `update`, so the desktop's idle-timeout save stays as it is. */
  @Mutation({
    input: z.object({ ppnRateBp: z.number().int().min(0).max(10000) }),
    output: settingsOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setPpnRate(@Ctx() ctx: Actor & { user: PublicUser }, @Input() input: { ppnRateBp: number }) {
    await this.rbac.require(ctx, 'settings.manage');
    return this.settings.update(input);
  }
}
