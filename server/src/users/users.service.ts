import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { KeycloakService } from '../keycloak/keycloak.service';
import { User, UserRole } from './user.entity';

/**
 * pg advisory lock key for changes that depend on who else exists:
 * "is this the first user?" and "does another admin remain?".
 */
const USERS_LOCK = 7_310_001;

/** `code` values of the 409 answers below, for clients that want to react specifically. */
export const USER_ERRORS = {
  lastAdmin: 'LAST_ADMIN',
  self: 'SELF',
  notApproved: 'NOT_APPROVED',
} as const;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly keycloak: KeycloakService,
  ) {}

  /**
   * Accounts created before roles existed: without an admin nobody could
   * approve anyone, so the earliest registered user takes that role.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (await this.users.exists({ where: { role: UserRole.Admin } })) {
      return;
    }
    const [first] = await this.users.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (!first) {
      return;
    }
    await this.users.update(first.id, {
      role: UserRole.Admin,
      approvedAt: first.approvedAt ?? new Date(),
    });
    this.logger.log(`No admin found, promoted earliest user ${first.email} to admin`);
  }

  /**
   * The very first user becomes an approved admin; everyone after that starts
   * as a user waiting for approval. The lock keeps two parallel sign-ups
   * from both counting as "first".
   */
  create(data: Pick<User, 'keycloakId' | 'email' | 'firstName' | 'lastName'>): Promise<User> {
    return this.lockedTransaction(async (manager) => {
      const isFirst = !(await manager.exists(User));
      return manager.save(
        manager.create(User, {
          ...data,
          role: isFirst ? UserRole.Admin : UserRole.User,
          approvedAt: isFirst ? new Date() : null,
        }),
      );
    });
  }

  existsByEmail(email: string): Promise<boolean> {
    return this.users.exists({ where: { email } });
  }

  findByKeycloakId(keycloakId: string): Promise<User | null> {
    return this.users.findOne({ where: { keycloakId } });
  }

  findAll(): Promise<User[]> {
    return this.users.find({ order: { createdAt: 'ASC' } });
  }

  /** Idempotent: approving an approved user keeps the original date. */
  async approve(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.approvedAt) {
      user.approvedAt = new Date();
      await this.users.save(user);
    }
    return user;
  }

  /** Only for approved users, never for yourself, and never demoting the last admin. */
  setRole(id: string, role: UserRole, actor: AuthenticatedUser): Promise<User> {
    return this.lockedTransaction(async (manager) => {
      const user = await this.findForChange(manager, id, actor, 'You cannot change your own role');
      if (!user.approvedAt) {
        throw new ConflictException({
          statusCode: 409,
          code: USER_ERRORS.notApproved,
          message: 'Approve the user before changing the role',
        });
      }
      if (user.role === role) {
        return user;
      }
      if (user.role === UserRole.Admin) {
        await this.ensureAnotherAdmin(manager, user.id);
      }
      user.role = role;
      return manager.save(user);
    });
  }

  /**
   * Removes the Keycloak account first: if that fails, nothing changed. If the
   * local delete fails afterwards, a retry works because Keycloak treats the
   * missing account as deleted.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.lockedTransaction(async (manager) => {
      const user = await this.findForChange(manager, id, actor, 'You cannot delete your own account');
      if (user.role === UserRole.Admin) {
        await this.ensureAnotherAdmin(manager, user.id);
      }
      await this.keycloak.deleteUser(user.keycloakId);
      await manager.delete(User, user.id);
      this.logger.log(`User ${user.email} deleted by ${actor.email ?? actor.sub}`);
    });
  }

  /**
   * Returns the local profile for a token. Users created directly in Keycloak
   * (e.g. via admin console) are provisioned on their first login.
   */
  async findOrCreateFromToken(claims: AuthenticatedUser): Promise<User> {
    const existing = await this.findByKeycloakId(claims.sub);
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

  private lockedTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [USERS_LOCK]);
      return work(manager);
    });
  }

  private async findForChange(
    manager: EntityManager,
    id: string,
    actor: AuthenticatedUser,
    selfMessage: string,
  ): Promise<User> {
    const user = await manager.findOne(User, { where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.keycloakId === actor.sub) {
      throw new ConflictException({ statusCode: 409, code: USER_ERRORS.self, message: selfMessage });
    }
    return user;
  }

  /** Without an admin nobody could approve new accounts any more. */
  private async ensureAnotherAdmin(manager: EntityManager, exceptId: string): Promise<void> {
    const others = await manager.exists(User, {
      where: { role: UserRole.Admin, approvedAt: Not(IsNull()), id: Not(exceptId) },
    });
    if (!others) {
      throw new ConflictException({
        statusCode: 409,
        code: USER_ERRORS.lastAdmin,
        message: 'At least one admin has to remain',
      });
    }
  }
}
