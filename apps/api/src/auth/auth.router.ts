import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { AuthService, type PublicUser } from './auth.service';
import { ProtectedMiddleware } from './protected.middleware';
import { RbacService } from './rbac.service';

// The generator hoists these into the shared contract, so every client sees one user shape.
const userOutput = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  hasPin: z.boolean(),
});
const sessionOutput = z.object({ user: userOutput, accessToken: z.string(), refreshToken: z.string() });
// A literal, not an import: the generator cannot hoist identifiers a schema references.
const pinInput = z.string().regex(/^\d{6}$/, 'PIN must be 6 digits.');

@Router({ alias: 'auth' })
export class AuthRouter {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Mutation({
    input: z.object({
      name: z.string().min(2).max(80),
      username: z.string().min(3).max(32),
      password: z.string().min(8).max(128),
    }),
    output: sessionOutput,
  })
  register(@Input() input: { name: string; username: string; password: string }) {
    return this.authService.register(input);
  }

  @Mutation({
    input: z.object({ username: z.string().min(3).max(32), password: z.string().min(8).max(128) }),
    output: sessionOutput,
  })
  login(@Input() input: { username: string; password: string }) {
    return this.authService.login(input);
  }

  @Mutation({ input: z.object({ refreshToken: z.string().min(1) }), output: sessionOutput })
  refresh(@Input('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Mutation({
    input: z.object({ refreshToken: z.string().min(1) }),
    output: z.object({ success: z.boolean() }),
  })
  async logout(@Input('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
    return { success: true };
  }

  /** Sign out but keep the profile on this tablet; the token is redeemable again via `pinLogin`. */
  @Mutation({
    input: z.object({ refreshToken: z.string().min(1) }),
    output: z.object({ success: z.boolean() }),
  })
  async park(@Input('refreshToken') refreshToken: string) {
    await this.authService.park(refreshToken);
    return { success: true };
  }

  @Mutation({
    input: z.object({ refreshToken: z.string().min(1), pin: pinInput }),
    output: sessionOutput,
  })
  pinLogin(@Input() input: { refreshToken: string; pin: string }) {
    return this.authService.pinLogin(input.refreshToken, input.pin);
  }

  @Mutation({
    input: z.object({ pin: pinInput, password: z.string().min(8).max(128).optional() }),
    output: userOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  setPin(@Ctx() ctx: { user: PublicUser }, @Input() input: { pin: string; password?: string }) {
    return this.authService.setPin(ctx.user.id, input);
  }

  // Extends rather than re-declares, so a field added to `userOutput` reaches `me` too.
  @Query({ output: userOutput.extend({ permissions: z.array(z.string()) }) })
  @UseMiddlewares(ProtectedMiddleware)
  async me(@Ctx() ctx: { user: PublicUser }) {
    return { ...ctx.user, permissions: await this.rbac.permissionsOf(ctx.user.id) };
  }
}
