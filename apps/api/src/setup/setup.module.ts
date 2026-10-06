import { Module } from '@nestjs/common';
import { SetupRouter } from './setup.router';
import { SetupService } from './setup.service';

// No AuthModule: neither procedure is protected. DRIZZLE comes from the global DbModule.
@Module({ providers: [SetupService, SetupRouter] })
export class SetupModule {}
