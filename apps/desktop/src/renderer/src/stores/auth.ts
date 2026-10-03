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
  /**
   * The lock screen is up (US-007). Persisted so a reload while locked stays locked. With no access
   * token the session is parked: only `auth.pinLogin` with the refresh token reopens it.
   */
  locked: boolean;
  setSession: (session: Session) => void;
  /** After a PIN change: `hasPin` is what the first-run screen and the lock read. */
  setUser: (user: Session['user']) => void;
  clear: () => void;
  setLocked: (locked: boolean) => void;
  /** Lock by parking: drop the access token, keep the (now parked) refresh token for the PIN. */
  park: () => void;
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
      // Ignored while parked: a refresh in flight when the desk locked must not un-park it. The PIN
      // unlock clears `locked` first, then saves its session.
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set((state) =>
          state.locked && !state.accessToken ? {} : { user, accessToken, refreshToken, outlet, outlets },
        ),
      setUser: (user) => set({ user }),
      clear: () => set(signedOut),
      setLocked: (locked) => set({ locked }),
      park: () => set({ accessToken: null, locked: true }),
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
