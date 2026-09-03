import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { createRefreshLink, createTokenProvider, type AppRouter } from '@repo/api-contract';
import { useAuthStore } from './stores/auth';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

/** Unauthenticated client used only by the refresh call, so a refresh can never recurse into itself. */
const refreshClient = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${API_URL}/trpc` })] });

const accessToken = createTokenProvider({
  getState: useAuthStore.getState,
  setSession: (session) => useAuthStore.getState().setSession(session),
  clear: () => useAuthStore.getState().clear(),
  refresh: (refreshToken) => refreshClient.auth.refresh.mutate({ refreshToken }),
});

/** A 401 the token's own `exp` could not predict (revoked user, rotated secret) still ends the session. */
const onAuthError = (error: unknown) => {
  if ((error as { data?: { code?: string } })?.data?.code === 'UNAUTHORIZED') useAuthStore.getState().clear();
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});

// Every path that ends a session (Sign out, an UNAUTHORIZED response, a failed refresh) funnels
// through the store, so this is the one chokepoint that drops the previous user's cached query
// results — instead of patching every caller that can end a session. Only the access-token
// set -> null transition counts; other writes (e.g. a token refresh) must not clear a live cache.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.accessToken !== null && state.accessToken === null) queryClient.clear();
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    // Above the HTTP link: headers() renews from `exp` before sending, this catches the 401s `exp`
    // cannot predict (secret rotated, user deleted, clock behind) and retries them once.
    createRefreshLink({ accessToken }),
    httpBatchLink({
      url: `${API_URL}/trpc`,
      async headers() {
        const token = await accessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
