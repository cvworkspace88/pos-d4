import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TRPCModule } from 'nestjs-trpc';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FloorModule } from './floor/floor.module';
import { OutletModule } from './outlet/outlet.module';
import { RoleModule } from './role/role.module';
import { SettingsModule } from './settings/settings.module';
import { AppContext } from './trpc/app.context';
import { errorFormatter } from './trpc/error-formatter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    TRPCModule.forRoot({ basePath: '/trpc', context: AppContext, errorFormatter }),
    AuthModule,
    SettingsModule,
    FloorModule,
    OutletModule,
    RoleModule,
  ],
  providers: [AppContext],
})
export class AppModule {}
