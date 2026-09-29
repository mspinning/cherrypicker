import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from './authenticated-user';

export const ROLES_KEY = 'roles';

/**
 * Runs after the global JwtAuthGuard on routes marked with @Roles().
 * Reads the role from the CRM database, so changes apply immediately
 * instead of after the next token refresh.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) {
      return true;
    }

    const claims = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    const user = claims ? await this.users.findByKeycloakId(claims.sub) : null;
    if (!user?.approvedAt || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
