import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { KeycloakService } from '../keycloak/keycloak.service';
import { AuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/**
 * Global guard: verifies the Keycloak access token (signature via JWKS,
 * issuer, expiry, authorized party) on every route not marked @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    private readonly keycloak: KeycloakService,
  ) {
    this.jwks = createRemoteJWKSet(new URL(keycloak.jwksUrl));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.keycloak.issuer });
      if (payload.azp !== this.keycloak.clientId || payload.typ !== 'Bearer') {
        throw new Error('Token not issued for this client');
      }
      request.user = payload as unknown as AuthenticatedUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
