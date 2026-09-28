import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MenuRouter } from './menu.router';
import { MenuService } from './menu.service';

@Module({
  imports: [AuthModule],
  providers: [MenuService, MenuRouter],
})
export class MenuModule {}
