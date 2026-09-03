import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { ProtectedMiddleware } from './protected.middleware';

@Router({ alias: 'auth' })
export class AuthRouter {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Mutation({
    input: z.object({
      name: z.string().min(2).max(80),
      email: z.email(),
      password: z.string().min(8).max(128),
    }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
  register(@Input() input: { name: string; email: string; password: string }) {
    return this.authService.register(input);
  }

  @Mutation({
    input: z.object({ email: z.email(), password: z.string().min(8).max(128) }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
  login(@Input() input: { email: string; password: string }) {
    return this.authService.login(input);
  }

  @Mutation({
    input: z.object({ refreshToken: z.string().min(1) }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
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

  @Query({ output: z.object({ id: z.string(), name: z.string(), email: z.string() }) })
  @UseMiddlewares(ProtectedMiddleware)
  me(@Ctx() ctx: { user: { id: string; name: string; email: string } }) {
    return ctx.user;
  }
}
