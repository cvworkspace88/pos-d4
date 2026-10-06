import type { NetworkInterfaceInfo } from 'node:os';

/**
 * The IPv4 addresses a tablet on the outlet Wi-Fi can reach (US-003). Loopback never can, and 169.254.x
 * is a cable with no DHCP behind it. IPv6 is left out: tablets and QR codes use the IPv4.
 */
export const lanAddresses = (interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] =>
  Object.values(interfaces).flatMap((list) =>
    (list ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map((a) => a.address),
  );

const MAX_LABEL_BYTES = 63;

/** The mDNS instance name: outlet plus machine, so two hubs of one chain tell apart. One DNS label, 63 bytes. */
export function advertName(outletName: string, hostname: string): string {
  const encoder = new TextEncoder();
  let name = '';
  for (const char of `${outletName} (${hostname})`) {
    if (encoder.encode(name + char).length > MAX_LABEL_BYTES) break;
    name += char;
  }
  return name;
}
