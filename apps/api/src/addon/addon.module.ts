import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AddonRouter } from './addon.router';
import { AddonService } from './addon.service';

@Module({
  imports: [AuthModule],
  providers: [AddonService, AddonRouter],
  // MenuService composes the whole menu, add-on groups included.
  exports: [AddonService],
})
export class AddonModule {}
