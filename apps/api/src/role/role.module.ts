import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoleRouter } from './role.router';
import { RoleService } from './role.service';

@Module({
  imports: [AuthModule],
  providers: [RoleService, RoleRouter],
})
export class RoleModule {}
