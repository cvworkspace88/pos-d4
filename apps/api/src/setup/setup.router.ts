import { Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Ctx, Input, Mutation, Query, Router } from 'nestjs-trpc';
import { z } from 'zod';
import { isLoopback, isTrustedOrigin } from './setup-rules';
import { SetupService, type SetupInput } from './setup.service';

/**
 * First-run setup of a hub (US-088). Both procedures are public: nobody can sign in before the owner
 * exists. Mounted on `local` only. `run` also needs a loopback peer and a desktop-renderer Origin.
 */
@Router({ alias: 'setup' })
export class SetupRouter {
  constructor(@Inject(SetupService) private readonly service: SetupService) {}

  @Query({ output: z.object({ needed: z.boolean() }) })
  status() {
    return this.service.status();
  }

  // Bounds mirror outlet.create, outlet.setBusinessDay and outlet.addStaff.
  @Mutation({
    input: z.object({
      outlet: z.object({
        name: z.string().trim().min(1).max(60),
        code: z
          .string()
          .trim()
          .min(1)
          .max(12)
          .regex(/^[a-zA-Z0-9-]+$/),
        address: z.string().trim().max(200).optional(),
        timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
        businessDayCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
      owner: z.object({
        name: z.string().trim().min(2).max(80),
        username: z.string().trim().min(3).max(32),
        password: z.string().min(8).max(128),
        pin: z.string().regex(/^\d{6}$/),
      }),
    }),
    output: z.object({ success: z.boolean() }),
  })
  async run(
    @Ctx() ctx: { req: { socket: { remoteAddress?: string }; headers: { origin?: string } } },
    @Input() input: SetupInput,
  ) {
    if (!isLoopback(ctx.req.socket.remoteAddress) || !isTrustedOrigin(ctx.req.headers.origin))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Siapkan outlet dari komputer kasir.' });
    await this.service.run(input);
    return { success: true };
  }
}
