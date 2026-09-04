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
      username: z.string().min(3).max(32),
      password: z.string().min(8).max(128),
    }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), username: z.string() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
  register(@Input() input: { name: string; username: string; password: string }) {
    return this.authService.register(input);
  }

  @Mutation({
    input: z.object({ username: z.string().min(3).max(32), password: z.string().min(8).max(128) }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), username: z.string() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
  login(@Input() input: { username: string; password: string }) {
    return this.authService.login(input);
  }

  @Mutation({
    input: z.object({ refreshToken: z.string().min(1) }),
    output: z.object({
      user: z.object({ id: z.string(), name: z.string(), username: z.string() }),
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

  @Query({ output: z.object({ id: z.string(), name: z.string(), username: z.string() }) })
  @UseMiddlewares(ProtectedMiddleware)
  me(@Ctx() ctx: { user: { id: string; name: string; username: string } }) {
    return ctx.user;
  }
}
