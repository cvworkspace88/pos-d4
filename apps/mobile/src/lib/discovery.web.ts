// Metro picks this on web, where browsers cannot do mDNS and the native module does not exist.
import type { FoundHubs } from './discovery';

export function useFoundHubs(): FoundHubs {
  return { hubs: [], supported: false, error: null };
}
