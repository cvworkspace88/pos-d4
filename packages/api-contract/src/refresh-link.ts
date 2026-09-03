import { observable, type Unsubscribable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import type { AppRouter } from './server';

export interface RefreshLinkDeps {
  /** The provider from `createTokenProvider`. */
  accessToken: (options?: { force?: boolean }) => Promise<string | null>;
}

/**
 * Retries an operation once, after a forced refresh, when the server answers UNAUTHORIZED.
 *
 * The token provider renews proactively from the JWT's `exp`, which covers ordinary expiry — this
 * link covers the cases `exp` cannot predict: the signing secret rotated, the user was deleted and
 * recreated, the database was restored, or the device clock is behind. Without it those all end the
 * session even though a refresh would have recovered it.
 *
 * Place it FIRST in the links array, above the terminating HTTP link. The refresh call itself must
 * go through a separate client that does not include this link, or a failing refresh recurses.
 * Retrying is safe for mutations too: a request rejected as UNAUTHORIZED never reached the handler.
 *
 * Assumes a single-emission terminating link (`httpBatchLink`). Values already forwarded are not
 * tracked, so a streaming link would replay whatever arrived before the error.
 */
export function createRefreshLink({ accessToken }: RefreshLinkDeps): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        let retried = false;
        let cancelled = false;
        let inner: Unsubscribable | null = null;

        const run = () => {
          inner = next(op).subscribe({
            next: (value) => observer.next(value),
            complete: () => observer.complete(),
            error: (error) => {
              // One retry only. A second UNAUTHORIZED means the fresh token was rejected too, so the
              // session is genuinely over and the error must reach the cache hook that ends it.
              if (retried || (error.data as { code?: string } | undefined)?.code !== 'UNAUTHORIZED')
                return observer.error(error);

              retried = true;
              accessToken({ force: true })
                .then((token) => {
                  if (cancelled) return;
                  // No token means the session is unrecoverable and the provider already cleared it.
                  if (token) run();
                  else observer.error(error);
                })
                .catch((refreshError) => {
                  // Refresh failed on its own terms (offline, 500). Surface THAT, not the original
                  // 401: the cache hook ends the session on any UNAUTHORIZED, and a transient
                  // failure must not cost the user a still-valid refresh token.
                  if (!cancelled) observer.error(refreshError);
                });
            },
          });
        };

        run();

        return () => {
          cancelled = true;
          inner?.unsubscribe();
        };
      });
}
