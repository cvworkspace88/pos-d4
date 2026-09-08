import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReservationRouter } from './reservation.router';
import { ReservationService } from './reservation.service';
import { TableRouter } from './table.router';
import { TableService } from './table.service';

@Module({
  imports: [AuthModule],
  providers: [TableService, TableRouter, ReservationService, ReservationRouter],
})
export class FloorModule {}
