import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RouterOutputs } from '@repo/api-contract';

type Session = RouterOutputs['auth']['login'];

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (session: Session) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (session) =>
        set({ user: session.user, accessToken: session.accessToken, refreshToken: session.refreshToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'pos-d4-auth', storage: createJSONStorage(() => localStorage) },
  ),
);
