import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { createRefreshLink, createTokenProvider, type AppRouter } from '@repo/api-contract';
import { useAuthStore } from './stores/auth';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/** A physical device cannot reach "localhost" — fall back to the host running Metro. */
function apiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:3333`;

  return 'http://localhost:3333';
}

/** Unauthenticated client used only by the refresh call, so a refresh can never recurse into itself. */
const refreshClient = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${apiUrl()}/trpc` })] });

// Which user the in-flight refresh belongs to. The provider shares one refresh across concurrent
// callers, so one slot is enough. A refresh that fails because its owner parked must not sign out
// whoever is using the tablet now — the reject-path twin of the identity check in setSession.
let refreshingFor: string | null = null;

const accessToken = createTokenProvider({
  getState: useAuthStore.getState,
  // The provider only refreshes the session that was active when the request started. By the time
  // it resolves that session may be gone (Sign out, idle park, cold start) or replaced (another
  // user PIN-logged-in meanwhile) — writing it back would undo the park, and on a shared tablet it
  // would hand the till to whoever is standing there under the previous user's name. Identity, not
  // presence: only the still-active user's own refresh may land. The rotated token still belongs in
  // that user's profile either way, or their card points at a token the server has already retired.
  setSession: (session) => {
    const store = useAuthStore.getState();
    if (store.accessToken !== null && store.user?.id === session.user.id) store.setSession(session);
    else store.rememberRotation(session);
  },
  clear: () => {
    const store = useAuthStore.getState();
    if (store.user === null || store.user.id === refreshingFor) store.clear();
  },
  refresh: (refreshToken) => {
    refreshingFor = useAuthStore.getState().user?.id ?? null;
    return refreshClient.auth.refresh.mutate({ refreshToken });
  },
});

/**
 * A 401 the token's own `exp` could not predict (revoked user, rotated secret) still ends the
 * session. A wrong PIN is a 401 too but must never end one — it is a failed attempt to START a
 * session, not proof the current one died.
 */
const onAuthError = (error: unknown) => {
  const data = (error as { data?: { code?: string; reason?: string } })?.data;
  if (data?.code === 'UNAUTHORIZED' && data.reason !== 'INVALID_PIN') useAuthStore.getState().clear();
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});

// Every path that ends a session (Sign out, an UNAUTHORIZED response, a failed refresh) funnels
// through the store, so this is the one chokepoint that drops the previous user's cached query
// results — instead of patching every caller that can end a session. Only the access-token
// set -> null transition counts; other writes (e.g. a token refresh, or rehydration — see
// stores/auth.ts) must not clear a live cache.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.accessToken !== null && state.accessToken === null) queryClient.clear();
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    // Above the HTTP link: headers() renews from `exp` before sending, this catches the 401s `exp`
    // cannot predict (secret rotated, user deleted, clock behind) and retries them once.
    createRefreshLink({ accessToken }),
    httpBatchLink({
      url: `${apiUrl()}/trpc`,
      async headers() {
        const token = await accessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
