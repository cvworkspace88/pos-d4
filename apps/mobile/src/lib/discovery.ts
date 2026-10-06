import { useEffect } from 'react';
import { useZeroconf } from 'react-native-zeroconf';

export interface FoundHub {
  name: string;
  host: string;
  port: number;
  outletId: string;
}

export interface FoundHubs {
  hubs: FoundHub[];
  /** False where mDNS cannot run (the web build). */
  supported: boolean;
  error: string | null;
}

// Must match the hub's HUB_MDNS_TYPE. app.config.ts puts it in iOS's NSBonjourServices (native rebuild).
const HUB_MDNS_TYPE = process.env.EXPO_PUBLIC_HUB_MDNS_TYPE ?? 'pos-hub';

/** Hubs advertising `_pos-hub._tcp` on this Wi-Fi (US-003). Only resolved ones with an IPv4 and an outlet. */
export function useFoundHubs(): FoundHubs {
  const { services, error } = useZeroconf({ type: HUB_MDNS_TYPE, protocol: 'tcp' });
  useEffect(() => {
    if (error) console.warn('mDNS discovery failed', error);
  }, [error]);
  const hubs = services.flatMap((s) =>
    s.ipv4[0] && s.txt.outletId
      ? [{ name: s.name, host: s.ipv4[0], port: s.port, outletId: s.txt.outletId }]
      : [],
  );
  return {
    hubs,
    supported: true,
    error: error ? 'Pencarian otomatis gagal. Pindai kode QR atau isi alamatnya.' : null,
  };
}
