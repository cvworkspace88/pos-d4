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
