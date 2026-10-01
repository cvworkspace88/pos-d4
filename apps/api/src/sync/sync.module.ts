import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SyncRouter } from './sync.router';
import { SyncService } from './sync.service';

@Module({
  imports: [AuthModule],
  providers: [SyncService, SyncRouter],
})
export class SyncModule {}
