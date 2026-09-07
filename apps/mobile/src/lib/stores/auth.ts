import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RouterOutputs } from '@repo/api-contract';

type Session = RouterOutputs['auth']['login'];
type User = Session['user'];

/** A user enrolled on this tablet: their parked refresh token, redeemable with their PIN. */
export interface Profile {
  user: User;
  refreshToken: string;
}

interface AuthState {
  // The one active session. Null between users.
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  // Everyone who has signed in on this tablet and not been removed, keyed by user id.
  profiles: Record<string, Profile>;
  hydrated: boolean;
  setHydrated: () => void;
  setSession: (session: Session) => void;
  setUser: (user: User) => void;
  rememberRotation: (session: Session) => void;
  park: () => void;
  removeProfile: (userId: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      profiles: {},
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      // The profile follows every rotation, so it holds a redeemable token even if the app dies
      // before anyone parks it.
      setSession: ({ user, accessToken, refreshToken }) =>
        set((state) => ({
          user,
          accessToken,
          refreshToken,
          profiles: { ...state.profiles, [user.id]: { user, refreshToken } },
        })),
      setUser: (user) =>
        set((state) => {
          const profile = state.profiles[user.id];
          return {
            user,
            profiles: profile ? { ...state.profiles, [user.id]: { ...profile, user } } : state.profiles,
          };
        }),
      // Handle racing condition, rare cases.
      // refresh token received after user signed out/session ended. 
      // without this the store will be cleared and the user will be logged out.
      rememberRotation: ({ user, refreshToken }) =>
        set((state) =>
          state.profiles[user.id]
            ? { profiles: { ...state.profiles, [user.id]: { user, refreshToken } } }
            : {},
        ),
      // Local half of "sign out, keep my profile". `lib/session.ts` tells the server.
      park: () => set({ user: null, accessToken: null, refreshToken: null }),
      removeProfile: (userId) =>
        set((state) => {
          const profiles = { ...state.profiles };
          delete profiles[userId];
          return { profiles };
        }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'pos-d4-auth',
      storage: createJSONStorage(() => AsyncStorage),
      // AsyncStorage is async, so screens must wait before deciding logged-in vs logged-out.
      // On rehydration failure zustand passes (undefined, error) — flip hydrated anyway so the
      // app starts logged out instead of spinning forever.
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('Auth rehydration failed; starting logged out.', error);
        const store = state ?? useAuthStore.getState();
        // A session that survived a restart is parked before any screen can render it, so every
        // cold start asks for a PIN. Local only — the store cannot reach trpcClient; the next
        // pinLogin rotates the token anyway.
        if (store.accessToken) store.park();
        store.setHydrated();
      },
      partialize: ({ user, accessToken, refreshToken, profiles }) => ({
        user,
        accessToken,
        refreshToken,
        profiles,
      }),
    },
  ),
);
