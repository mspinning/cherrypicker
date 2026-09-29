import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { UserRole } from '../../users/user.entity';
import { ROLES_KEY, RolesGuard } from '../roles.guard';

/** Restricts a route or controller to approved users with one of the given roles. */
export const Roles = (...roles: UserRole[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(RolesGuard),
    ApiForbiddenResponse({ description: `Requires role: ${roles.join(', ')}` }),
  );
