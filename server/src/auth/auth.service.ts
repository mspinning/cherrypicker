import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { KeycloakService } from '../keycloak/keycloak.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenResponseDto } from './dto/token-response.dto';

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
      return UserResponseDto.from(user, ['user']);
    } catch (err) {
      this.logger.error(`Local user creation failed, rolling back Keycloak user ${keycloakId}`, err as Error);
      await this.keycloak.deleteUser(keycloakId);
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    return TokenResponseDto.from(await this.keycloak.login(dto.email, dto.password));
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    return TokenResponseDto.from(await this.keycloak.refresh(refreshToken));
  }

  logout(refreshToken: string): Promise<void> {
    return this.keycloak.logout(refreshToken);
  }
}
