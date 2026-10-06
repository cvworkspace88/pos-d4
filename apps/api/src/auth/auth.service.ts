import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { DRIZZLE, type Database } from '../db/db.module';
import { outletStaff, outlets, refreshTokens, users, type User } from '../db/schema';
import { hubOutlet } from '../hub/hub-outlet';
import { verifyPassword, verifyPin } from './pin-check';
import { firstPinNeedsPassword, rejectPinLogin } from './pin-policy';
import { Reason } from '../trpc/error-formatter';
import { rejectRefresh } from './refresh-window';

/** What clients see of a user. `hasPin` tells mobile whether to demand one before opening the app. */
export const publicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  hasPin: user.pinHash !== null,
});
export type PublicUser = ReturnType<typeof publicUser>;

/** An outlet as the session names it. The picker needs nothing more. */
export type OutletRef = { id: string; name: string };

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  /** The active outlet. Null until chosen (zero or many outlets), or when the chosen one is gone. */
  outlet: OutletRef | null;
  /** Every outlet this user may work at: all live outlets for a global role, else their memberships. */
  outlets: OutletRef[];
}

/** What the access JWT carries. `outletId` is what `RbacService` scopes the role by. */
/** `pwd`: minted by a password login (not a refresh or a PIN) — what lets a first PIN skip the password. */
export type AccessPayload = { sub: string; username: string; outletId: string | null; pwd?: true };

/** Opaque refresh tokens are stored hashed; SHA-256 is enough since the token is 32 random bytes. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A row a client may still present: live, or parked behind a PIN. Both must die on logout and both
 * may be rotated by a PIN login, so every write that "kills" or "consumes" a token uses this.
 */
const alive = or(isNull(refreshTokens.revokedAt), eq(refreshTokens.revokedReason, 'parked'));

/** FORBIDDEN: we know who this is; they just do not work there. A 401 would sign them out. */
const notAssigned = () => new TRPCError({ code: 'FORBIDDEN', message: 'Outlet tidak ditemukan.' });

/** US-008: a hub-bound device (every `local` client) refuses whoever does not work at the hub's outlet. */
const notHere = () => new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak terdaftar di outlet ini.' });

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: { username: string; password: string }): Promise<Session> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, input.username.toLowerCase()), isNull(users.deletedAt)));
    // NOTE: an unknown username short-circuits without an argon2 verify, so it answers in ~1ms
    // against ~100ms for a real one — a username-enumeration signal. Verifying against a dummy hash
    // would even the cost; see backlog.md before changing this.
    // A locked account throws here (FORBIDDEN + `LOCKED`), even for the right password.
    const valid = user ? await verifyPassword(this.db, user, input.password) : false;
    // One message for both halves, so it never says which of the two was wrong.
    if (!user || !valid)
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Username atau kata sandi salah.' });

    return this.issueSession(user, await this.boundOutlet(user), true);
  }

  async refresh(token: string, outletId?: string): Promise<Session> {
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

    // Checked before rotation so a refused pick leaves the presented token usable.
    if (outletId !== undefined && !(await this.outletsOf(user)).some((o) => o.id === outletId))
      throw notAssigned();

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
    return this.issueSession(user, outletId ?? row.outletId);
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

    // Before rotation, as `refresh` checks a pick: a refused PIN login leaves the parked token as it was.
    const bound = await this.boundOutlet(user);

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
    return this.issueSession(user, bound ?? row.outletId);
  }

  /**
   * Every PIN failure that is about the credential is UNAUTHORIZED — a wrong PIN is an invalid
   * credential, not an authorization refusal. `reason` carries what the code no longer can:
   * `INVALID_PIN` means the profile is fine and the digits were not, so the client keeps the card; no
   * reason means the profile itself is dead and the card goes. Load-bearing — see the README
   * error-code table. Five wrong PINs in ten minutes lock it (`verifyPin`), answered FORBIDDEN: the
   * card stays, the user waits.
   */
  private async checkPin(user: User, pin: string): Promise<void> {
    if (!(await verifyPin(this.db, user, pin)))
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Belum ada PIN. Masuk dengan kata sandi.' });
  }

  /**
   * Changing an existing PIN needs the password. Setting the first one does not, but only within
   * `FIRST_PIN_WINDOW_MS` of a password login (`passwordAt`): the "Buat PIN" screen that follows it
   * has no password left to re-enter, while a session left open must not mint an approval PIN.
   * A password, when sent, is always checked. A missing one is `FORBIDDEN` + `NEEDS_PASSWORD`, so the
   * client shows its password field and resends.
   */
  async setPin(
    userId: string,
    input: { pin: string; password?: string },
    passwordAt: number | null,
  ): Promise<PublicUser> {
    const user = await this.userFromPayload({ sub: userId });

    if (input.password !== undefined) {
      // Counts toward the password lock: otherwise a stolen access token guesses passwords here freely.
      if (!(await verifyPassword(this.db, user, input.password)))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Password salah.' });
    } else if (user.pinHash || firstPinNeedsPassword(passwordAt)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: user.pinHash
          ? 'Masukkan password untuk mengganti PIN.'
          : 'Masukkan password untuk membuat PIN.',
        cause: new Reason('NEEDS_PASSWORD'),
      });
    }

    // A new PIN starts with a clean slate: the lock guarded the old one.
    const [updated] = await this.db
      .update(users)
      .set({ pinHash: await argon2.hash(input.pin), pinFailures: 0, pinWindowStartedAt: null })
      .where(eq(users.id, userId))
      .returning();
    return publicUser(updated!);
  }

  /**
   * The desktop lock screen (US-007): the same user re-enters their password. FORBIDDEN, never
   * UNAUTHORIZED, on a wrong one — a 401 would end the session the lock screen is protecting.
   */
  async unlock(userId: string, password: string): Promise<void> {
    if (!(await verifyPassword(this.db, await this.userFromPayload({ sub: userId }), password)))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Password salah.' });
  }

  /**
   * Self-service only, and only with the current password: it counts toward and obeys the password
   * lock. A forgotten password is a staff manager's reset (US-057), never this.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const user = await this.userFromPayload({ sub: userId });
    // FORBIDDEN, not UNAUTHORIZED: a typo here must not sign the user out.
    if (!(await verifyPassword(this.db, user, input.currentPassword)))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Password saat ini salah.' });
    // ponytail: other sessions stay signed in; revoke the user's other refresh tokens if a leaked password must lock everyone out.
    await this.db
      .update(users)
      .set({ passwordHash: await argon2.hash(input.newPassword) })
      .where(eq(users.id, userId));
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

  /** `passwordAt`: when a password login minted this token (ms), null for a refresh or PIN one. */
  async userFromAccessToken(
    token: string,
  ): Promise<{ user: User; outletId: string | null; passwordAt: number | null }> {
    const payload = await this.jwt
      .verifyAsync<AccessPayload & { iat?: number }>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
      .catch(() => {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token.' });
      });
    return {
      user: await this.userFromPayload(payload),
      outletId: payload.outletId ?? null,
      passwordAt: payload.pwd && payload.iat ? payload.iat * 1000 : null,
    };
  }

  /**
   * On a `local` hub every device is bound to the hub's outlet (US-008): only its staff, or a global role,
   * sign in there, and they land on it. Undefined off the hub (cloud: pick freely) and before first-run
   * setup (no outlet to bind to yet). Called after the credential check, so it never answers a wrong
   * password with a membership fact.
   */
  private async boundOutlet(user: User): Promise<string | undefined> {
    if (this.config.get('DEPLOYMENT') !== 'local') return undefined;
    const outlet = await hubOutlet(this.db);
    if (!outlet) return undefined;
    if (!(await this.outletsOf(user)).some((o) => o.id === outlet.id)) throw notHere();
    return outlet.id;
  }

  /** The outlets a user may work at, live only, sorted by name. A global role works everywhere. */
  private async outletsOf(user: User): Promise<OutletRef[]> {
    if (user.roleId)
      return this.db
        .select({ id: outlets.id, name: outlets.name })
        .from(outlets)
        .where(isNull(outlets.deletedAt))
        .orderBy(asc(outlets.name));

    return this.db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .innerJoin(outletStaff, eq(outletStaff.outletId, outlets.id))
      .where(and(eq(outletStaff.userId, user.id), isNull(outlets.deletedAt)))
      .orderBy(asc(outlets.name));
  }

  /**
   * `wanted` is the caller's choice (a pick, or the outlet carried on the refresh row); undefined
   * means "none yet". Either way it only sticks while the user may still work there, and a lone
   * outlet is chosen for them — so a closed outlet or a lost membership silently falls back to
   * null (re-pick) or to the one outlet left.
   */
  private async issueSession(user: User, wanted?: string | null, password = false): Promise<Session> {
    const mine = await this.outletsOf(user);
    const outlet = mine.find((o) => o.id === wanted) ?? (mine.length === 1 ? mine[0]! : null);
    const outletId = outlet?.id ?? null;

    const payload: AccessPayload = {
      sub: user.id,
      username: user.username,
      outletId,
      ...(password ? { pwd: true as const } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });

    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS', '30'));
    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      outletId,
    });

    return { user: publicUser(user), accessToken, refreshToken, outlet, outlets: mine };
  }
}
