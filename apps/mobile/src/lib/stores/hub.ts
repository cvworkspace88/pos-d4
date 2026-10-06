import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HubAddress } from '@repo/api-contract';

export interface SavedHub extends HubAddress {
  outletName: string;
}

interface HubState {
  /** Every hub this tablet has used, by outlet. Re-pairing a known outlet at a new IP replaces its entry. */
  hubs: Record<string, SavedHub>;
  /** The outlet whose hub the app talks to. Null until the first pairing. */
  current: string | null;
  hydrated: boolean;
  choose: (hub: SavedHub) => void;
  setHydrated: () => void;
}

export const useHubStore = create<HubState>()(
  persist(
    (set) => ({
      hubs: {},
      current: null,
      hydrated: false,
      choose: (hub) =>
        set((state) => ({ hubs: { ...state.hubs, [hub.outletId]: hub }, current: hub.outletId })),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'pos-d4-hub',
      storage: createJSONStorage(() => AsyncStorage),
      // Same as the auth store: flip `hydrated` even on failure, so the app asks for a hub instead of spinning.
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('Hub rehydration failed; asking for a hub again.', error);
        (state ?? useHubStore.getState()).setHydrated();
      },
      partialize: ({ hubs, current }) => ({ hubs, current }),
    },
  ),
);

export const currentHub = (state: Pick<HubState, 'hubs' | 'current'>): SavedHub | null =>
  state.current ? (state.hubs[state.current] ?? null) : null;
