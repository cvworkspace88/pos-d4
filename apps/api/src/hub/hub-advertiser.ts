import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bonjour } from 'bonjour-service';
import type { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import { advertName } from './hub-rules';
import { HubService } from './hub.service';

const RETRY_MS = 10_000;
const GOODBYE_MS = 1_000;

/**
 * Advertises `_pos-hub._tcp` (`HUB_MDNS_TYPE` renames it) so tablets find the hub without an IP (US-003).
 * Best effort: mDNS failing (port 5353 taken, no network) is logged and never stops the API, since selling does not need it, and
 * tablets can still scan the QR or type the address.
 */
@Injectable()
export class HubAdvertiser implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Hub');
  private bonjour: Bonjour | null = null;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    @Inject(HubService) private readonly hub: HubService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    void this.publish();
  }

  // ponytail: published once with the name at that moment; renaming the outlet reaches the advert on the
  // next hub start (`hub.info`, which tablets show after connecting, is always current).
  private async publish(): Promise<void> {
    const info = await this.hub.info().catch(() => null);
    // Before first-run setup there is no outlet to name or pair with, and without a LAN address the advert
    // would carry no A record (tablets drop it): look again until both exist.
    if (!info?.outlet || info.addresses.length === 0) {
      this.retry = setTimeout(() => void this.publish(), RETRY_MS);
      return;
    }
    // Must match the tablets' EXPO_PUBLIC_HUB_MDNS_TYPE (and NSBonjourServices on iOS), or they find nothing.
    const type = this.config.get<string>('HUB_MDNS_TYPE', 'pos-hub');
    try {
      this.bonjour = new Bonjour(undefined, (error: Error) =>
        this.logger.warn(`mDNS unavailable: ${error.message}`),
      );
      // multicast-dns reports a failed bind (EADDRINUSE/EACCES) as an async 'error' event that bonjour-service
      // never listens for; unhandled it would kill the hub. `server` is private in the typings.
      (this.bonjour as unknown as { server: { mdns: EventEmitter } }).server.mdns.on(
        'error',
        (error: Error) => this.logger.warn(`mDNS unavailable: ${error.message}`),
      );
      this.bonjour.publish({
        name: advertName(info.outlet.name, hostname()),
        // Own host name: the default os.hostname() A/AAAA records fight the Mac's mDNSResponder, which then
        // renames the computer (MacBook-Pro-2, -3, ...).
        host: `${type}-${info.outlet.id.slice(0, 8)}.local`,
        type,
        port: info.port,
        txt: { outletId: info.outlet.id, v: '1' },
      });
      this.logger.log(`advertising _${type}._tcp for ${info.outlet.name} on port ${info.port}`);
    } catch (error) {
      this.logger.warn(`mDNS unavailable: ${(error as Error).message}`);
    }
  }

  // Returns a promise so Nest waits for the goodbye packets to leave before the process is killed; capped
  // so shutdown can never hang.
  onApplicationShutdown(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    const bonjour = this.bonjour;
    if (!bonjour) return Promise.resolve();
    return new Promise((resolve) => {
      const cap = setTimeout(resolve, GOODBYE_MS);
      // Goodbye packets, so tablets drop the hub at once instead of after the record's TTL.
      bonjour.unpublishAll(() => {
        bonjour.destroy();
        clearTimeout(cap);
        resolve();
      });
    });
  }
}
