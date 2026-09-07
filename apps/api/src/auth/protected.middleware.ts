import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc';
import { AuthService, publicUser } from './auth.service';

@Injectable()
export class ProtectedMiddleware implements TRPCMiddleware {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async use(opts: MiddlewareOptions): MiddlewareResponse {
    const { ctx, next } = opts;
    const { req } = ctx as { req?: { headers: Record<string, string | undefined> } };

    const header = req?.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing bearer token.' });

    const user = await this.authService.userFromAccessToken(token);

    return next({ ctx: { user: publicUser(user) } });
  }
}
