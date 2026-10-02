import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from './auth.service';
import { ProtectedMiddleware } from './protected.middleware';
import { RbacService } from './rbac.service';
import type { Actor } from './rbac-rules';

type Ctx = Actor & { user: PublicUser };

/** The manager PIN override (US-010). Approving itself happens inside each overridable mutation. */
@Router({ alias: 'approval' })
export class ApprovalRouter {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  /** Who may approve `permission` at the caller's outlet with their PIN. Any signed-in user may ask. */
  @Query({
    input: z.object({ permission: z.string().max(60) }),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async approvers(@Ctx() ctx: Ctx, @Input('permission') permission: string) {
    return this.rbac.approvers(ctx, permission);
  }

  /** Lift a requester's approval block early (US-010). Audited as `approval.unblocked`. */
  @Mutation({ input: z.object({ userId: z.uuid() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async unblock(@Ctx() ctx: Ctx, @Input('userId') userId: string) {
    await this.rbac.require(ctx, 'approval.unblock');
    return this.rbac.unblock(ctx, userId);
  }
}
