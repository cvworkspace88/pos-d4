import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards plain REST controllers. tRPC procedures use ProtectedMiddleware instead. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
