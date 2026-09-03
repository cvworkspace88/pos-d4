import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RouterOutputs } from '@repo/api-contract';

type Session = RouterOutputs['auth']['login'];

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setHydrated: () => void;
  setSession: (session: Session) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      setSession: (session) =>
        set({ user: session.user, accessToken: session.accessToken, refreshToken: session.refreshToken }),
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
        (state ?? useAuthStore.getState()).setHydrated();
      },
      partialize: ({ user, accessToken, refreshToken }) => ({ user, accessToken, refreshToken }),
    },
  ),
);
