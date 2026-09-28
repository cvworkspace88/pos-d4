import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AddonRouter } from './addon.router';
import { AddonService } from './addon.service';

@Module({
  imports: [AuthModule],
  providers: [AddonService, AddonRouter],
})
export class AddonModule {}
