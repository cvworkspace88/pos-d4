import { useAuthStore } from './stores/auth';
import { trpcClient } from './trpc';

/**
 * Sign out but keep the profile on this tablet. Local state goes first, so a slow or failed call
 * can never trap the user in a signed-in shell. The server call is fire-and-forget: without it the
 * token merely stays plain-refreshable until the next PIN login rotates it.
 */
export function park(): void {
  const { user, refreshToken, park: parkLocal, removeProfile: forgetLocal } = useAuthStore.getState();
  parkLocal();
  // The server signs a PIN-less user out rather than parking them — there is no PIN to redeem the
  // token with — so keeping the card would leave one that can never be tapped. Reachable: sign in,
  // get redirected to /set-pin, walk away, and let the idle timer park before a PIN was ever set.
  if (user && !user.hasPin) forgetLocal(user.id);
  if (refreshToken) void trpcClient.auth.park.mutate({ refreshToken }).catch(() => undefined);
}

/** Forget a profile on this tablet and kill its token server-side. */
export function removeProfile(userId: string): void {
  const { profiles, removeProfile } = useAuthStore.getState();
  const refreshToken = profiles[userId]?.refreshToken;
  removeProfile(userId);
  if (refreshToken) void trpcClient.auth.logout.mutate({ refreshToken }).catch(() => undefined);
}
