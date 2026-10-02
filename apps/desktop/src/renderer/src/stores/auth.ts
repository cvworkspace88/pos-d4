import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RouterOutputs } from '@repo/api-contract';

type Session = RouterOutputs['auth']['login'];

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  outlet: Session['outlet'];
  outlets: Session['outlets'];
  /** The lock screen is up (US-007). Persisted so a reload while locked stays locked. */
  locked: boolean;
  setSession: (session: Session) => void;
  clear: () => void;
  setLocked: (locked: boolean) => void;
}

const signedOut = {
  user: null,
  accessToken: null,
  refreshToken: null,
  outlet: null,
  outlets: [],
  locked: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set({ user, accessToken, refreshToken, outlet, outlets }),
      clear: () => set(signedOut),
      setLocked: (locked) => set({ locked }),
    }),
    {
      name: 'pos-d4-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ user, accessToken, refreshToken, outlet, outlets, locked }) => ({
        user,
        accessToken,
        refreshToken,
        outlet,
        outlets,
        locked,
      }),
    },
  ),
);
