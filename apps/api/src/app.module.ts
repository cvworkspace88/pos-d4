import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TRPCModule } from 'nestjs-trpc';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { AppContext } from './trpc/app.context';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    TRPCModule.forRoot({ basePath: '/trpc', context: AppContext }),
    AuthModule,
  ],
  providers: [AppContext],
})
export class AppModule {}
