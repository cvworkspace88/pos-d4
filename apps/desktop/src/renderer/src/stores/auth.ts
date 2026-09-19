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
  // "Show the picker although an outlet is set." Not persisted, and not the same as clearing
  // `outlet`: the token provider's auto-refresh calls setSession, which would put it straight back.
  switching: boolean;
  setSession: (session: Session) => void;
  startSwitch: () => void;
  clear: () => void;
}

const signedOut = {
  user: null,
  accessToken: null,
  refreshToken: null,
  outlet: null,
  outlets: [],
  switching: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set({ user, accessToken, refreshToken, outlet, outlets, switching: false }),
      startSwitch: () => set({ switching: true }),
      clear: () => set(signedOut),
    }),
    {
      name: 'pos-d4-auth',
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
