import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, isNull } from 'drizzle-orm';
import { networkInterfaces } from 'node:os';
import { DRIZZLE, type Database } from '../db/db.module';
import { outlets } from '../db/schema';
import { lanAddresses } from './hub-rules';

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
    // ponytail: one hub per outlet (US-053 v1 ceiling), so the first live outlet is the hub's. A hub serving
    // several outlets would need an explicit "this hub's outlet" setting.
    const [outlet] = await this.db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(isNull(outlets.deletedAt))
      .orderBy(asc(outlets.createdAt))
      .limit(1);
    return {
      outlet: outlet ?? null,
      port: Number(this.config.get('PORT', '3333')),
      addresses: lanAddresses(networkInterfaces()),
    };
  }
}
