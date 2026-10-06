import type { ConfigContext, ExpoConfig } from 'expo/config';

// iOS discovers only the Bonjour types listed here, so the type comes from the same env as discovery
// (`EXPO_PUBLIC_HUB_MDNS_TYPE`, src/lib/discovery.ts) and must match the hub's HUB_MDNS_TYPE. Native: changing
// it needs a rebuild (`expo prebuild --clean` / `expo run:ios`), not just a Metro restart.
const hubType = process.env.EXPO_PUBLIC_HUB_MDNS_TYPE ?? 'pos-hub';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  ios: {
    ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, NSBonjourServices: [`_${hubType}._tcp`] },
  },
});
