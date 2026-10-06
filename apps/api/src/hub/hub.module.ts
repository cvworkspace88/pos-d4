import { Module } from '@nestjs/common';
import { HubAdvertiser } from './hub-advertiser';
import { HubRouter } from './hub.router';
import { HubService } from './hub.service';

// No AuthModule: `hub.info` is public. DRIZZLE comes from the global DbModule, ConfigService from the global ConfigModule.
@Module({ providers: [HubService, HubRouter, HubAdvertiser] })
export class HubModule {}
