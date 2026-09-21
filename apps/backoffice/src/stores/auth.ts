import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Session } from '@repo/api-contract';

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (session: Session) => void;
  clear: () => void;
}

const signedOut = { user: null, accessToken: null, refreshToken: null };

// ponytail: outlet/outlets from the session are dropped — backoffice is owner-scoped and has no
// outlet picker yet. Add them back (see desktop's store) when a screen here is outlet-scoped.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setSession: ({ user, accessToken, refreshToken }) => set({ user, accessToken, refreshToken }),
      clear: () => set(signedOut),
    }),
    {
      name: 'pos-d4-backoffice-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ user, accessToken, refreshToken }) => ({ user, accessToken, refreshToken }),
    },
  ),
);
