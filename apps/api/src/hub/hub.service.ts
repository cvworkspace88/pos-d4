import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { networkInterfaces } from 'node:os';
import { DRIZZLE, type Database } from '../db/db.module';
import { lanAddresses } from './hub-rules';
import { hubOutlet } from './hub-outlet';

export interface HubInfo {
  /** The outlet this hub serves. Null until first-run setup (US-088) has made one. */
  outlet: { id: string; name: string } | null;
  port: number;
  /** LAN IPv4 addresses, the first one is what the QR code carries. */
  addresses: string[];
}

@Injectable()
export class HubService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async info(): Promise<HubInfo> {
    return {
      outlet: await hubOutlet(this.db),
      port: Number(this.config.get('PORT', '3333')),
      addresses: lanAddresses(networkInterfaces()),
    };
  }
}
