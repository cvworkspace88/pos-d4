import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditRouter } from './audit.router';
import { AuditService } from './audit.service';

@Module({
  imports: [AuthModule],
  providers: [AuditService, AuditRouter],
})
export class AuditModule {}
