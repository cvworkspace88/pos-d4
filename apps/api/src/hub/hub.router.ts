import { Inject } from '@nestjs/common';
import { Query, Router } from 'nestjs-trpc';
import { z } from 'zod';
import { HubService } from './hub.service';

/** LAN pairing (US-003). Mounted on `local` only. */
@Router({ alias: 'hub' })
export class HubRouter {
  constructor(@Inject(HubService) private readonly hub: HubService) {}

  /**
   * Public: tablets ping it before anyone signs in, and the pairing screen asks a candidate hub who it
   * is. It tells a LAN peer nothing the mDNS advert does not already.
   */
  @Query({
    output: z.object({
      outlet: z.object({ id: z.string(), name: z.string() }).nullable(),
      port: z.number().int(),
      addresses: z.array(z.string()),
    }),
  })
  info() {
    return this.hub.info();
  }
}
