import { rejectRefresh } from './refresh-window.ts';

interface TokenRow {
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: 'rotated' | 'logout' | 'parked' | null;
}

/**
 * Why this refresh token cannot be redeemed with a PIN, or null if it can.
 *
 * A parked row is the whole point of PIN login, so it passes where `rejectRefresh` refuses it.
 * Everything else follows the refresh rules: live passes, rotated-within-grace passes (a PIN login
 * whose response was lost becomes a retry), signed-out and stale rows stay dead. Expiry wins first.
 *
 * Pure and decorator-free so `node --test` can import it — same reason `refresh-window.ts` exists.
 */
export function rejectPinLogin(row: TokenRow, now = Date.now()): 'expired' | 'revoked' | null {
  if (row.expiresAt.getTime() < now) return 'expired';
  if (row.revokedReason === 'parked') return null;
  return rejectRefresh(row, now);
}
