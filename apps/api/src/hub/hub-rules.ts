import type { NetworkInterfaceInfo } from 'node:os';

/**
 * Adapters that exist only inside this machine or a VPN: VM and container bridges (OrbStack, Docker, Hyper-V
 * and WSL, VirtualBox, VMware) and tunnels. A tablet on the Wi-Fi can never reach them, so the QR must not
 * carry one. macOS/Linux names first, then Windows' (`vEthernet (WSL)`, `VMware Network Adapter VMnet8`).
 */
// ponytail: by name, so an unknown virtual adapter still slips through (listed, maybe first in the QR); the
// page lists every address and the tablet can type another. Upgrade: rank by default-route interface.
const VIRTUAL =
  /^(bridge|utun|vmnet|vboxnet|docker|br-|virbr|veth|tun|tap)|vEthernet|VirtualBox|VMware|Tailscale|ZeroTier/i;

/**
 * The IPv4 addresses a tablet on the outlet Wi-Fi can reach (US-003). Loopback never can, 169.254.x is a
 * cable with no DHCP behind it, and virtual adapters live inside this machine. IPv6 is left out: tablets
 * and QR codes use the IPv4.
 */
export const lanAddresses = (interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] =>
  Object.entries(interfaces).flatMap(([name, list]) =>
    VIRTUAL.test(name)
      ? []
      : (list ?? [])
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
