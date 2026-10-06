/** What a tablet needs to reach a hub (US-003). The desktop's QR code carries exactly this. */
export interface HubAddress {
  host: string;
  port: number;
  outletId: string;
}

export const encodeHubQr = ({ host, port, outletId }: HubAddress): string =>
  JSON.stringify({ host, port, outletId });

/** Null for anything else a camera might see (a menu link, a receipt), so a stray scan is ignored, not a crash. */
export function parseHubQr(text: string): HubAddress | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { host, port, outletId } = value as Record<string, unknown>;
  if (typeof host !== 'string' || host.trim() === '') return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof outletId !== 'string' || outletId === '') return null;
  return { host: host.trim(), port, outletId };
}

export const hubUrl = ({ host, port }: { host: string; port: number }): string =>
  `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

/** How often a foreground tablet asks the hub `hub.info`. */
export const HUB_PING_MS = 10_000;

export type HubLink = 'online' | 'reconnecting' | 'offline';

/** Consecutive failed pings to banner state: one miss is a blip, two mean the hub is gone. */
export const hubLink = (failures: number): HubLink =>
  failures <= 0 ? 'online' : failures === 1 ? 'reconnecting' : 'offline';

export const HUB_UNREACHABLE =
  'Hub tidak menjawab. Pastikan tablet di Wi-Fi yang sama dan aplikasi kasir di komputer terbuka.';

/**
 * Why `info` is not a hub this tablet may use, or null if it is. `expectedOutletId` comes from a QR
 * code: a code photographed at another outlet must not pair this tablet there.
 */
export function checkHub(
  info: { outlet: { id: string; name: string } | null },
  expectedOutletId?: string,
): string | null {
  if (!info.outlet) return 'Hub belum disiapkan. Selesaikan penyiapan di komputer kasir dulu.';
  if (expectedOutletId !== undefined && info.outlet.id !== expectedOutletId)
    return 'Hub ini milik outlet lain. Pilih hub outlet ini atau pindai kode di halaman Perangkat di komputer kasir.';
  return null;
}
