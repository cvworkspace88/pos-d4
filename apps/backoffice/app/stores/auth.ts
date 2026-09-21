import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Session } from '@repo/api-contract';

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  outlet: Session['outlet'];
  outlets: Session['outlets'];
  setSession: (session: Session) => void;
  clear: () => void;
}

const signedOut = { user: null, accessToken: null, refreshToken: null, outlet: null, outlets: [] };

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set({ user, accessToken, refreshToken, outlet, outlets }),
      clear: () => set(signedOut),
    }),
    {
      name: 'pos-d4-backoffice-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ user, accessToken, refreshToken, outlet, outlets }) => ({
        user,
        accessToken,
        refreshToken,
        outlet,
        outlets,
      }),
    },
  ),
);
