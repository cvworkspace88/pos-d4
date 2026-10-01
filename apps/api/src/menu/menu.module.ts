import { Module } from '@nestjs/common';
import { AddonModule } from '../addon/addon.module';
import { AuthModule } from '../auth/auth.module';
import { CategoryModule } from '../category/category.module';
import { MenuRouter } from './menu.router';
import { MenuService } from './menu.service';

@Module({
  // MenuService composes categories and add-on groups into the one-call menu.
  imports: [AuthModule, CategoryModule, AddonModule],
  providers: [MenuService, MenuRouter],
})
export class MenuModule {}
