import type { RouterOutputs } from './types';

export type Session = RouterOutputs['auth']['login'];

/** Renew this many seconds early so a token cannot expire between the header call and the server. */
const SKEW_SECONDS = 30;

export interface TokenProviderDeps {
  getState: () => { accessToken: string | null; refreshToken: string | null };
  setSession: (session: Session) => void;
  clear: () => void;
  refresh: (refreshToken: string) => Promise<Session>;
}

/**
 * Reads `exp` out of a JWT without verifying it — the server still decides. Unreadable means expired.
 * `atob` is a global on all three targets: Chromium (Electron), Node (tests), and Hermes, which has
 * implemented it since React Native 0.74 (unpadded input included, fixed in 0.74.1).
 */
export function expiresWithin(token: string, seconds: number, now = Date.now()): boolean {
  try {
    const base64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(base64)) as { exp?: number };
    return typeof exp !== 'number' || exp * 1000 - now <= seconds * 1000;
  } catch {
    return true;
  }
}

/**
 * Returns a usable access token, refreshing first when the current one is dead or nearly dead.
 * Returns null when there is no refresh token to recover with — the store is cleared, so the UI
 * falls back to login. When refresh itself fails, the store is cleared only if the server actually
 * rejected the credential (UNAUTHORIZED); any other error (offline, 500, DNS) leaves the still-valid
 * refresh token alone and rejects instead, so the caller never sends a request with no Authorization
 * header.
 *
 * `force` skips the expiry check: the server rejected a token that still looked live locally (secret
 * rotated, user deleted, device clock behind), so `exp` is not to be trusted for this attempt.
 */
export function createTokenProvider({ getState, setSession, clear, refresh }: TokenProviderDeps) {
  // auth.refresh rotates and revokes the presented token, so concurrent callers MUST share one call.
  let inFlight: Promise<Session> | null = null;

  return async function accessToken(options?: { force?: boolean }): Promise<string | null> {
    const current = getState();
    if (!options?.force && current.accessToken && !expiresWithin(current.accessToken, SKEW_SECONDS))
      return current.accessToken;
    if (!current.refreshToken) {
      if (current.accessToken) clear();
      return null;
    }

    inFlight ??= refresh(current.refreshToken)
      .then((session) => {
        setSession(session);
        return session;
      })
      .catch((error: unknown) => {
        // Only the server saying "no" clears a still-valid refresh token; a transient failure must not.
        if ((error as { data?: { code?: string } })?.data?.code === 'UNAUTHORIZED') clear();
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight.then((session) => session.accessToken);
  };
}
