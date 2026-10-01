import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import type { PublicUser } from '../auth/auth.service';
import type { Actor } from '../auth/rbac-rules';
import { SettingsService, type AppSettings } from './settings.service';

const settingsOutput = z.object({ idleTimeoutSeconds: z.number(), desktopLockSeconds: z.number().int() });

@Router({ alias: 'settings' })
export class SettingsRouter {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Any signed-in user may read: tablets need the idle timeout, the desktop its lock timer. */
  @Query({ output: settingsOutput })
  @UseMiddlewares(ProtectedMiddleware)
  get() {
    return this.settings.get();
  }

  @Mutation({
    // A patch: each screen saves only its own field.
    input: z.object({
      idleTimeoutSeconds: z.number().int().min(30).max(3600).optional(),
      desktopLockSeconds: z.number().int().min(0).max(3600).optional(),
    }),
    output: settingsOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Actor & { user: PublicUser }, @Input() input: Partial<AppSettings>) {
    await this.rbac.require(ctx, 'settings.manage');
    return this.settings.update(input);
  }
}
