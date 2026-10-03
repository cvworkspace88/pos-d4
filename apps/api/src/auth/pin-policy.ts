import { REVOKE_GRACE_MS, rejectRefresh } from './refresh-window.ts';

interface TokenRow {
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: 'rotated' | 'logout' | 'parked' | 'pin_rotated' | null;
}

/**
 * Why this refresh token cannot be redeemed with a PIN, or null if it can.
 *
 * A parked row is the whole point of PIN login, so it passes where `rejectRefresh` refuses it.
 * Everything else follows the refresh rules: live passes, signed-out and stale rows stay dead.
 * Expiry wins first.
 *
 * `pin_rotated` carries its own copy of the rotation grace, and it lives HERE rather than in
 * `rejectRefresh` on purpose. A PIN login whose response was lost has to become a retry, but the
 * retry must be another `pinLogin` — one that asks for the PIN again. Were the row stamped plain
 * `rotated`, `rejectRefresh` would hand the same token a PIN-free session for the length of the
 * window, so every legitimate PIN login would briefly undo the parking it just redeemed.
 *
 * Pure and decorator-free so `node --test` can import it — same reason `refresh-window.ts` exists.
 */
export function rejectPinLogin(row: TokenRow, now = Date.now()): 'expired' | 'revoked' | null {
  if (row.expiresAt.getTime() < now) return 'expired';
  if (!row.revokedAt) return null;
  if (row.revokedReason === 'parked') return null;
  if (row.revokedReason === 'pin_rotated')
    return now - row.revokedAt.getTime() > REVOKE_GRACE_MS ? 'revoked' : null;
  return rejectRefresh(row, now);
}

/** Wrong PINs allowed inside one window before the PIN locks (US-006, US-010). */
export const PIN_MAX_FAILURES = 5;
/** How long the counting window runs, and how long a lock lasts once the fifth failure lands. */
export const PIN_WINDOW_MS = 10 * 60 * 1000;
/** The password lock (US-005): same five failures, a fifteen-minute window and lock. */
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

/** The two `users` columns the lock lives in. A `User` row satisfies it as is. */
export interface PinFailures {
  pinFailures: number;
  pinWindowStartedAt: Date | null;
}

/** Milliseconds until this PIN (or, with `windowMs`, password) may be tried again; 0 when not locked. */
export function pinLockedFor(state: PinFailures, now = Date.now(), windowMs = PIN_WINDOW_MS): number {
  if (state.pinFailures < PIN_MAX_FAILURES || !state.pinWindowStartedAt) return 0;
  return Math.max(0, state.pinWindowStartedAt.getTime() + windowMs - now);
}

/**
 * The counter after one more wrong PIN. A window older than `PIN_WINDOW_MS` (or an expired lock)
 * starts over at 1. The failure that reaches the limit restamps the window, so the lock runs a full
 * window from the attempt that triggered it rather than from the first miss.
 */
export function nextPinFailure(state: PinFailures, now = Date.now()): PinFailures {
  const start = state.pinWindowStartedAt?.getTime();
  if (start === undefined || now - start >= PIN_WINDOW_MS)
    return { pinFailures: 1, pinWindowStartedAt: new Date(now) };
  const pinFailures = state.pinFailures + 1;
  return {
    pinFailures,
    pinWindowStartedAt: pinFailures >= PIN_MAX_FAILURES ? new Date(now) : state.pinWindowStartedAt,
  };
}

/** How long after a password login a first PIN may be set without typing the password again. */
export const FIRST_PIN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether setting a first PIN needs the password re-entered (US-006). A first PIN is free only right
 * after a password login — mobile's and desktop's "Buat PIN" screen — never on a session someone
 * left open: a PIN is also an approval credential (US-010). `passwordAt` is when this session's
 * access token was minted by a password login; null when a refresh or a PIN minted it.
 */
export const firstPinNeedsPassword = (passwordAt: number | null, now = Date.now()): boolean =>
  passwordAt === null || now - passwordAt > FIRST_PIN_WINDOW_MS;
