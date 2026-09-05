/**
 * Rotation revokes the presented token before its replacement reaches the client, so a response lost
 * in transit (signal drop, app killed) would strand a client holding a token we already killed.
 * Honouring a just-rotated token for this long turns that forced logout into a successful retry.
 */
export const REVOKE_GRACE_MS = 30_000;

interface RefreshRow {
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: 'rotated' | 'logout' | 'parked' | null;
}

/**
 * Why this refresh token cannot be redeemed, or null if it can.
 *
 * Lives outside `AuthService` only so it is importable by a test runner — `@Injectable()` is runtime
 * syntax that Node's type stripping rejects. This is the production path, not a copy of it.
 */
export function rejectRefresh(row: RefreshRow, now = Date.now()): 'expired' | 'revoked' | null {
  if (row.expiresAt.getTime() < now) return 'expired';
  if (!row.revokedAt) return null;
  // Only a rotation earns the window. A signed-out token is dead the instant it is stamped, and a
  // row with no reason predates the column — treat both as final.
  if (row.revokedReason !== 'rotated') return 'revoked';
  return now - row.revokedAt.getTime() > REVOKE_GRACE_MS ? 'revoked' : null;
}
