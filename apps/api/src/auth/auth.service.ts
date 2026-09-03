import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { DRIZZLE, type Database } from '../db/db.module';
import { refreshTokens, users, type User } from '../db/schema';
import { rejectRefresh } from './refresh-window';

export interface Session {
  user: { id: string; name: string; email: string };
  accessToken: string;
  refreshToken: string;
}

/** Opaque refresh tokens are stored hashed; SHA-256 is enough since the token is 32 random bytes. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: { name: string; email: string; password: string }): Promise<Session> {
    const email = input.email.toLowerCase();
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered.' });

    const [user] = await this.db
      .insert(users)
      .values({ name: input.name, email, passwordHash: await argon2.hash(input.password) })
      .returning();

    return this.issueSession(user!);
  }

  async login(input: { email: string; password: string }): Promise<Session> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email.toLowerCase()));
    // Always verify against something so a missing user and a wrong password cost the same.
    const valid = user ? await argon2.verify(user.passwordHash, input.password) : false;
    if (!user || !valid) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });

    return this.issueSession(user);
  }

  async refresh(token: string): Promise<Session> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)));

    if (!row || rejectRefresh(row))
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token.' });

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId));
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token.' });

    // Rotate: the presented token dies with the new one's birth. Only the first use stamps it, so a
    // retry inside the grace window cannot slide the window forward indefinitely.
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)));
    return this.issueSession(user);
  }

  /** Keeps the row as history; the reason is what stops `refresh` handing it the rotation grace. */
  async logout(token: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'logout' })
      .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
  }

  /** Single source of truth for "who is this bearer token", used by JwtStrategy and the tRPC middleware. */
  async userFromPayload(payload: { sub?: string }): Promise<User> {
    if (!payload.sub) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const [user] = await this.db.select().from(users).where(eq(users.id, payload.sub));
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return user;
  }

  async userFromAccessToken(token: string): Promise<User> {
    const payload = await this.jwt
      .verifyAsync<{ sub: string }>(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') })
      .catch(() => {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token.' });
      });
    return this.userFromPayload(payload);
  }

  private async issueSession(user: User): Promise<Session> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
      },
    );

    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS', '30'));
    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    });

    return { user: { id: user.id, name: user.name, email: user.email }, accessToken, refreshToken };
  }
}
