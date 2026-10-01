import { Inject } from '@nestjs/common';
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeOutlet } from '../auth/active-outlet';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import type { Actor } from '../auth/rbac-rules';
import { SyncService } from './sync.service';

/** Sync between the outlet hub and the cloud. `push`/`pull` arrive with US-049/US-050. */
@Router({ alias: 'sync' })
export class SyncRouter {
  constructor(@Inject(SyncService) private readonly service: SyncService) {}

  /** Any signed-in user: every POS screen shows the sync badge. Scoped to the active outlet. */
  @Query({ output: z.number().int() })
  @UseMiddlewares(ProtectedMiddleware)
  pendingCount(@Ctx() ctx: Actor) {
    return this.service.pendingCount(activeOutlet(ctx));
  }
}
