import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsRouter } from './settings.router';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthModule],
  providers: [SettingsService, SettingsRouter],
})
export class SettingsModule {}
