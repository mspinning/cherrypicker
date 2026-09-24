import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  create(data: Pick<User, 'keycloakId' | 'email' | 'firstName' | 'lastName'>): Promise<User> {
    return this.users.save(this.users.create(data));
  }

  existsByEmail(email: string): Promise<boolean> {
    return this.users.exists({ where: { email } });
  }

  /**
   * Returns the local profile for a token. Users created directly in Keycloak
   * (e.g. via admin console) are provisioned on first access.
   */
  async findOrCreateFromToken(claims: AuthenticatedUser): Promise<User> {
    const existing = await this.users.findOne({ where: { keycloakId: claims.sub } });
    if (existing) {
      return existing;
    }
    return this.create({
      keycloakId: claims.sub,
      email: (claims.email ?? claims.preferred_username ?? '').toLowerCase(),
      firstName: claims.given_name ?? '',
      lastName: claims.family_name ?? '',
    });
  }
}
