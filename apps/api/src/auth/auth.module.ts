import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthRouter } from './auth.router';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { ProtectedMiddleware } from './protected.middleware';
import { RbacService } from './rbac.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  providers: [AuthService, AuthRouter, JwtStrategy, ProtectedMiddleware, RbacService],
  // Other modules guard their procedures with the middleware and the permission check.
  exports: [AuthService, ProtectedMiddleware, RbacService],
})
export class AuthModule {}
