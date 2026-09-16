import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OutletRouter } from './outlet.router';
import { OutletService } from './outlet.service';

@Module({
  imports: [AuthModule],
  providers: [OutletService, OutletRouter],
})
export class OutletModule {}
