import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TRPCError } from '@trpc/server';
import { Reason } from '../trpc/error-formatter';
import * as argon2 from 'argon2';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { DRIZZLE, type Database } from '../db/db.module';
import { refreshTokens, users, type User } from '../db/schema';
import { rejectPinLogin } from './pin-policy';
import { rejectRefresh } from './refresh-window';

/** What clients see of a user. `hasPin` tells mobile whether to demand one before opening the app. */
export const publicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  hasPin: user.pinHash !== null,
});
export type PublicUser = ReturnType<typeof publicUser>;

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/** Opaque refresh tokens are stored hashed; SHA-256 is enough since the token is 32 random bytes. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A row a client may still present: live, or parked behind a PIN. Both must die on logout and both
 * may be rotated by a PIN login, so every write that "kills" or "consumes" a token uses this.
 */
const alive = or(isNull(refreshTokens.revokedAt), eq(refreshTokens.revokedReason, 'parked'));

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: { name: string; username: string; password: string }): Promise<Session> {
    const username = input.username.toLowerCase();
    // Deliberately unfiltered by `deleted_at`: a soft-deleted row still holds the unique index, so
    // filtering here would turn a clean CONFLICT into a raw constraint violation.
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Username already taken.' });

    const [user] = await this.db
      .insert(users)
      .values({ name: input.name, username, passwordHash: await argon2.hash(input.password) })
      .returning();

    return this.issueSession(user!);
  }

  async login(input: { username: string; password: string }): Promise<Session> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, input.username.toLowerCase()), isNull(users.deletedAt)));
    // NOTE: an unknown username short-circuits without an argon2 verify, so it answers in ~1ms
    // against ~100ms for a real one — a username-enumeration signal. Verifying against a dummy hash
    // would even the cost; see backlog.md before changing this.
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

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, row.userId), isNull(users.deletedAt)));
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token.' });

    // Rotate: the presented token dies with the new one's birth. Only the first use stamps it, so a
    // retry inside the grace window cannot slide the window forward indefinitely.
    const rotated = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });

    // Matching nothing means a `park` or `logout` landed between the read above and this write, so
    // the row we validated is no longer the row on disk — issuing a session here would hand out a
    // live token for a profile the user believes is parked. A grace-window retry also matches
    // nothing, but its `revokedAt` was already set when we read it, so it is not the race.
    if (!rotated.length && row.revokedAt === null)
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token.' });
    return this.issueSession(user);
  }

  /**
   * Keeps the row as history; the reason is what stops `refresh` handing it the rotation grace.
   * Parked rows die here too — this is how a profile is removed from a tablet.
   */
  async logout(token: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'logout' })
      .where(and(eq(refreshTokens.tokenHash, hashToken(token)), alive));
  }

  /**
   * "Sign out, keep my profile." The row stays redeemable, but only through `pinLogin`: `refresh`
   * refuses every reason but `rotated`. Idempotent — a parked row is left alone, so its timestamp
   * cannot slide. A user with no PIN is signed out instead; see below.
   */
  async park(token: string): Promise<void> {
    const [row] = await this.db
      .select({ id: refreshTokens.id, pinHash: users.pinHash })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
    if (!row) return;

    // Without a PIN there is no way back in, so parking would leave a card that can never be
    // tapped and a row neither endpoint can clear. Sign that user out properly instead.
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: row.pinHash ? 'parked' : 'logout' })
      .where(eq(refreshTokens.id, row.id));
  }

  /** `refresh` with a PIN gate: redeems a parked (or live) token and rotates it like any refresh. */
  async pinLogin(token: string, pin: string): Promise<Session> {
    const dead = new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Profile expired. Sign in with your password.',
    });

    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)));
    if (!row || rejectPinLogin(row)) throw dead;

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, row.userId), isNull(users.deletedAt)));
    if (!user) throw dead;

    await this.checkPin(user, pin);

    // Rotation, as in `refresh` — but stamped `pin_rotated`, not `rotated`. Only `rejectPinLogin`
    // grants that reason a grace window, so redeeming a profile cannot re-open the PIN-free
    // `refresh` path for the token it just consumed. A row already stamped (a retry inside the
    // window) is left as is, so the window cannot slide.
    const rotated = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'pin_rotated' })
      .where(and(eq(refreshTokens.id, row.id), alive))
      .returning({ id: refreshTokens.id });

    // Same read-then-write race as `refresh`, but "claimable at read time" is wider here: a parked
    // row carries a non-null `revokedAt`, so it must be tested against `alive`, not against null.
    // Only a `pin_rotated` retry inside the grace window legitimately matches nothing.
    const wasClaimable = row.revokedAt === null || row.revokedReason === 'parked';
    if (!rotated.length && wasClaimable) throw dead;
    return this.issueSession(user);
  }

  /**
   * Every PIN failure is UNAUTHORIZED — a wrong PIN is an invalid credential, not an authorization
   * refusal. `reason` carries what the code no longer can: `INVALID_PIN` means the profile is fine
   * and the digits were not, so the client keeps the card; no reason means the profile itself is
   * dead and the card goes. Load-bearing — see the README error-code table. The formatter is what
   * puts `cause` on the wire. No attempt counter, by decision.
   */
  private async checkPin(user: User, pin: string): Promise<void> {
    if (!user.pinHash)
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No PIN set. Sign in with your password.' });
    if (!(await argon2.verify(user.pinHash, pin)))
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong PIN.', cause: new Reason('INVALID_PIN') });
  }

  /**
   * Changing an existing PIN needs the password. Setting the first one does not: the bearer token
   * was minted by a password login moments ago and the client has no password left to re-enter.
   */
  async setPin(userId: string, input: { pin: string; password?: string }): Promise<PublicUser> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });

    if (user.pinHash) {
      const valid = input.password ? await argon2.verify(user.passwordHash, input.password) : false;
      if (!valid)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Enter your password to change your PIN.' });
    }

    const [updated] = await this.db
      .update(users)
      .set({ pinHash: await argon2.hash(input.pin) })
      .where(eq(users.id, userId))
      .returning();
    return publicUser(updated!);
  }

  /** Single source of truth for "who is this bearer token", used by JwtStrategy and the tRPC middleware. */
  async userFromPayload(payload: { sub?: string }): Promise<User> {
    if (!payload.sub) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)));
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
      { sub: user.id, username: user.username },
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

    return { user: publicUser(user), accessToken, refreshToken };
  }
}
