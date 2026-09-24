import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface TokenSet {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  token_type: string;
  id_token?: string;
  scope: string;
}

export interface CreateKeycloakUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Thin client for the Keycloak REST API.
 *  - OIDC token endpoint (login / refresh / logout) with the confidential crm-backend client
 *  - Admin API (user creation) via the client's service account
 */
@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly cfg: AppConfig['keycloak'];
  private adminToken?: { token: string; expiresAt: number };

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('keycloak', { infer: true });
  }

  private get realmUrl(): string {
    return `${this.cfg.internalUrl}/realms/${this.cfg.realm}`;
  }

  private get adminUrl(): string {
    return `${this.cfg.internalUrl}/admin/realms/${this.cfg.realm}`;
  }

  get issuer(): string {
    return `${this.cfg.publicUrl}/realms/${this.cfg.realm}`;
  }

  get jwksUrl(): string {
    return `${this.realmUrl}/protocol/openid-connect/certs`;
  }

  get clientId(): string {
    return this.cfg.clientId;
  }

  // ---------- OIDC ----------

  async login(username: string, password: string): Promise<TokenSet> {
    return this.tokenRequest({ grant_type: 'password', username, password, scope: 'openid' });
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.tokenRequest(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'Invalid or expired refresh token',
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const res = await fetch(`${this.realmUrl}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: this.form({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      this.logger.warn(`Logout failed: ${res.status} ${await res.text()}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async tokenRequest(
    params: Record<string, string>,
    rejectionMessage = 'Invalid credentials',
  ): Promise<TokenSet> {
    const res = await fetch(`${this.realmUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: this.form(params),
    });
    if (res.ok) {
      return (await res.json()) as TokenSet;
    }
    const body = await res.text();
    if (res.status === 400 || res.status === 401) {
      this.logger.debug(`Token request rejected: ${res.status} ${body}`);
      throw new UnauthorizedException(rejectionMessage);
    }
    this.logger.error(`Token request failed: ${res.status} ${body}`);
    throw new BadGatewayException('Identity provider unavailable');
  }

  private form(params: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      ...params,
    });
  }

  // ---------- Admin API ----------

  /** Creates a user in Keycloak and returns its id (the token `sub`). */
  async createUser(user: CreateKeycloakUser): Promise<string> {
    const res = await this.adminFetch('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: user.email,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: true,
        emailVerified: false,
        credentials: [{ type: 'password', value: user.password, temporary: false }],
      }),
    });

    if (res.status === 409) {
      throw new ConflictException('A user with this email already exists');
    }
    if (res.status === 400) {
      // e.g. password policy violation
      const body = (await res.json().catch(() => ({}))) as {
        errorMessage?: string;
        error_description?: string;
      };
      throw new BadRequestException(
        body.error_description ?? body.errorMessage ?? 'User could not be created',
      );
    }
    if (!res.ok) {
      this.logger.error(`Create user failed: ${res.status} ${await res.text()}`);
      throw new BadGatewayException('Identity provider unavailable');
    }

    // Keycloak returns the new id only in the Location header
    const location = res.headers.get('location');
    const id = location?.split('/').pop();
    if (!id) {
      throw new BadGatewayException('Identity provider returned no user id');
    }
    return id;
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.adminFetch(`/users/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      this.logger.error(`Delete user ${id} failed: ${res.status} ${await res.text()}`);
    }
  }

  private async adminFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getAdminToken();
    return fetch(`${this.adminUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }

  /** Service-account token (client_credentials), cached until shortly before expiry. */
  private async getAdminToken(): Promise<string> {
    if (this.adminToken && this.adminToken.expiresAt > Date.now()) {
      return this.adminToken.token;
    }
    const tokens = await this.tokenRequest({ grant_type: 'client_credentials' }).catch(
      (err: unknown) => {
        this.logger.error('Could not obtain service-account token', err as Error);
        throw new BadGatewayException('Identity provider unavailable');
      },
    );
    this.adminToken = {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in - 30) * 1000,
    };
    return this.adminToken.token;
  }
}
