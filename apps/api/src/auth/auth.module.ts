import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthRouter } from './auth.router';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { ProtectedMiddleware } from './protected.middleware';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  providers: [AuthService, AuthRouter, JwtStrategy, ProtectedMiddleware],
  exports: [AuthService],
})
export class AuthModule {}
