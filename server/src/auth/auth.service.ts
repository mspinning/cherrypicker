import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { KeycloakService, TokenSet } from '../keycloak/keycloak.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from './authenticated-user';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenResponseDto } from './dto/token-response.dto';

/** `code` of the 403 body when the account still needs an admin's approval. */
export const APPROVAL_PENDING = 'APPROVAL_PENDING';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly keycloak: KeycloakService,
    private readonly users: UsersService,
  ) {}

  /**
   * Creates the identity in Keycloak, then the local CRM profile.
   * If the local insert fails, the Keycloak user is removed again so both stay in sync.
   */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    if (await this.users.existsByEmail(dto.email)) {
      throw new ConflictException('A user with this email already exists');
    }

    const keycloakId = await this.keycloak.createUser(dto);
    try {
      const user = await this.users.create({
        keycloakId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });
      return UserResponseDto.from(user);
    } catch (err) {
      this.logger.error(`Local user creation failed, rolling back Keycloak user ${keycloakId}`, err as Error);
      await this.keycloak.deleteUser(keycloakId).catch(() => undefined);
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const tokens = await this.keycloak.login(dto.email, dto.password);
    await this.ensureApproved(tokens);
    return TokenResponseDto.from(tokens);
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const tokens = await this.keycloak.refresh(refreshToken);
    await this.ensureApproved(tokens);
    return TokenResponseDto.from(tokens);
  }

  logout(refreshToken: string): Promise<void> {
    return this.keycloak.logout(refreshToken);
  }

  /**
   * Runs only after Keycloak accepted the credentials, so the "waiting for
   * approval" answer never tells a stranger that an email is registered.
   * The fresh Keycloak session is ended again right away.
   */
  private async ensureApproved(tokens: TokenSet): Promise<void> {
    // Straight from Keycloak's token endpoint, so decoding without verifying is safe here
    const claims = decodeJwt(tokens.access_token) as unknown as AuthenticatedUser;
    const user = await this.users.findOrCreateFromToken(claims);
    if (user.approvedAt) {
      return;
    }
    await this.keycloak.logout(tokens.refresh_token).catch(() => undefined);
    throw new ForbiddenException({
      statusCode: 403,
      code: APPROVAL_PENDING,
      message: 'Your account is waiting for approval by an administrator',
    });
  }
}
