import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { decodeJwt } from 'jose';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { SecretBox } from '../secret-box.service';
import { MicrosoftConnection, MicrosoftConnectionStatus } from './microsoft-connection.entity';
import {
  MicrosoftAppConfigError,
  MicrosoftAuthError,
  MicrosoftNotConnectedError,
  MicrosoftReauthRequiredError,
} from './microsoft.errors';

const LOGIN_HOST = 'https://login.microsoftonline.com';
export const GRAPH_URL = 'https://graph.microsoft.com/v1.0';

/** Delegated permissions: read mail, read and write the calendar. `offline_access` yields the refresh token. */
const SCOPES = ['offline_access', 'openid', 'profile', 'email', 'User.Read', 'Mail.Read', 'Calendars.ReadWrite'];
const REQUIRED_SCOPES = ['Mail.Read', 'Calendars.ReadWrite'];

const STATE_PURPOSE = 'microsoft-oauth-state';
const TOKEN_PURPOSE = 'microsoft-token';
const STATE_TTL_MS = 10 * 60_000;
/** Renew the access token this long before it expires, so long Graph calls do not run into the expiry */
const REFRESH_MARGIN_MS = 3 * 60_000;
const TIMEOUT_MS = 20_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

interface StatePayload {
  /** CRM user id */
  u: string;
  /** Also stored in a cookie: the flow must end in the browser that started it */
  n: string;
  /** PKCE code verifier */
  v: string;
  /** expiry, epoch ms */
  e: number;
}

class TokenEndpointError extends Error {
  constructor(
    message: string,
    readonly error: string | undefined,
  ) {
    super(message);
  }
}

/**
 * OAuth 2.0 authorization code flow (with PKCE) against the Microsoft
 * identity platform, plus access-token renewal for Graph calls.
 */
@Injectable()
export class MicrosoftAuthService {
  private readonly logger = new Logger(MicrosoftAuthService.name);
  private readonly cfg: AppConfig['microsoft'];
  /** One refresh per user at a time; parallel Graph calls share it */
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    config: ConfigService<AppConfig, true>,
    @InjectRepository(MicrosoftConnection) private readonly connections: Repository<MicrosoftConnection>,
    private readonly secrets: SecretBox,
  ) {
    this.cfg = config.get('microsoft', { infer: true });
  }

  get configured(): boolean {
    return this.missingConfig().length === 0;
  }

  /** Environment variables an admin still has to set */
  missingConfig(): string[] {
    return [
      ...(this.cfg.clientId ? [] : ['MICROSOFT_CLIENT_ID']),
      ...(this.cfg.clientSecret ? [] : ['MICROSOFT_CLIENT_SECRET']),
      ...(this.secrets.configured ? [] : ['INTEGRATIONS_ENCRYPTION_KEY']),
    ];
  }

  get scopes(): string[] {
    return REQUIRED_SCOPES;
  }

  // ---------- Authorization ----------

  /** URL of the Microsoft sign-in page; `nonce` goes into a cookie of the starting browser. */
  startAuthorization(userId: string): { url: string; nonce: string } {
    if (!this.configured) {
      throw new MicrosoftAuthError('not_configured', 'Microsoft 365 is not configured');
    }
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const payload: StatePayload = { u: userId, n: nonce, v: verifier, e: Date.now() + STATE_TTL_MS };

    const url = new URL(`${LOGIN_HOST}/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state: this.secrets.seal(JSON.stringify(payload), STATE_PURPOSE),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      // Lets people with several accounts pick the right mailbox
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), nonce };
  }

  /** Handles the redirect back from Microsoft; stores the tokens of the signed-in mailbox. */
  async completeAuthorization(
    query: { code?: string; state?: string; error?: string; error_description?: string },
    cookieNonce: string | undefined,
  ): Promise<MicrosoftConnection> {
    if (query.error) {
      this.logger.warn(`Microsoft sign-in ended with ${query.error}: ${query.error_description ?? ''}`);
      throw new MicrosoftAuthError(
        query.error === 'access_denied' ? 'denied' : 'failed',
        query.error_description ?? query.error,
      );
    }
    const state = this.readState(query.state, cookieNonce);
    if (!query.code) throw new MicrosoftAuthError('failed', 'No authorization code');

    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: this.cfg.redirectUri,
        code_verifier: state.v,
      });
    } catch (err) {
      // invalid_client: secret ID instead of its value, expired secret, wrong client id
      throw new MicrosoftAuthError(isAppRejected(err) ? 'app_config' : 'failed', (err as Error).message);
    }

    const granted = new Set(scopesOf(tokens.scope));
    const missing = REQUIRED_SCOPES.filter((scope) => !granted.has(scope.toLowerCase()));
    if (missing.length || !tokens.refresh_token) {
      throw new MicrosoftAuthError('missing_scopes', `Missing permissions: ${missing.join(', ') || 'offline_access'}`);
    }

    const me = await this.fetchMe(tokens.access_token);
    const claims = tokens.id_token ? decodeJwt(tokens.id_token) : {};

    const owner = await this.connections.findOne({ where: { msUserId: me.id } });
    if (owner && owner.userId !== state.u) {
      throw new MicrosoftAuthError('mailbox_taken', 'Mailbox already linked to another CRM user');
    }

    const connection = (await this.connections.findOne({ where: { userId: state.u } })) ?? this.connections.create({ userId: state.u });
    const switched = connection.msUserId !== me.id;
    Object.assign(connection, {
      msUserId: me.id,
      tenantId: typeof claims.tid === 'string' ? claims.tid : null,
      email: (me.mail || me.userPrincipalName || '').toLowerCase(),
      displayName: me.displayName ?? '',
      scopes: [...granted].join(' '),
      refreshToken: this.secrets.seal(tokens.refresh_token, TOKEN_PURPOSE),
      accessToken: this.secrets.seal(tokens.access_token, TOKEN_PURPOSE),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: MicrosoftConnectionStatus.Active,
      lastError: null,
      connectedAt: switched || !connection.connectedAt ? new Date() : connection.connectedAt,
    });
    const saved = await this.connections.save(connection);
    this.logger.log(`Microsoft 365 mailbox ${saved.email} connected for user ${state.u}`);
    return saved;
  }

  private readState(raw: string | undefined, cookieNonce: string | undefined): StatePayload {
    let state: StatePayload;
    try {
      state = JSON.parse(this.secrets.open(raw ?? '', STATE_PURPOSE)) as StatePayload;
    } catch {
      throw new MicrosoftAuthError('invalid_state', 'State could not be verified');
    }
    // Without the cookie someone could make a victim finish a flow started for another CRM account
    const sameBrowser =
      !!cookieNonce &&
      cookieNonce.length === state.n.length &&
      timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(state.n));
    if (!sameBrowser || state.e < Date.now()) {
      throw new MicrosoftAuthError('invalid_state', 'State expired or started in another browser');
    }
    return state;
  }

  private async fetchMe(accessToken: string): Promise<{ id: string; displayName?: string; mail?: string; userPrincipalName?: string }> {
    const res = await fetch(`${GRAPH_URL}/me?$select=id,displayName,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: Error) => {
      throw new MicrosoftAuthError('failed', `Graph not reachable: ${err.message}`);
    });
    if (!res.ok) throw new MicrosoftAuthError('failed', `Graph /me answered ${res.status}`);
    return (await res.json()) as { id: string; displayName?: string; mail?: string; userPrincipalName?: string };
  }

  // ---------- Tokens ----------

  /** A valid Graph access token for the user, renewed with the refresh token when needed. */
  async accessToken(userId: string, forceRefresh = false): Promise<string> {
    const connection = await this.connections
      .createQueryBuilder('c')
      .addSelect(['c.accessToken', 'c.refreshToken'])
      .where('c.user_id = :userId', { userId })
      .getOne();
    if (!connection) throw new MicrosoftNotConnectedError();
    if (connection.status === MicrosoftConnectionStatus.ReauthRequired) throw new MicrosoftReauthRequiredError();

    const fresh = connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
    const cached = !forceRefresh && fresh && connection.accessToken ? this.tryOpen(connection.accessToken) : null;
    if (cached) return cached;

    let pending = this.refreshing.get(userId);
    if (!pending) {
      pending = this.refresh(connection).finally(() => this.refreshing.delete(userId));
      this.refreshing.set(userId, pending);
    }
    return pending;
  }

  private async refresh(connection: MicrosoftConnection): Promise<string> {
    const refreshToken = this.tryOpen(connection.refreshToken);
    if (!refreshToken) {
      return this.requireReauth(connection, 'Stored token cannot be decrypted (was INTEGRATIONS_ENCRYPTION_KEY changed?)');
    }
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    } catch (err) {
      // invalid_grant: revoked consent, changed password, expired after 90 days of inactivity …
      if (err instanceof TokenEndpointError && err.error === 'invalid_grant') {
        return this.requireReauth(connection, err.message);
      }
      if (isAppRejected(err)) {
        this.logger.error(`Microsoft rejects the app registration: ${(err as Error).message}`);
        throw new MicrosoftAppConfigError();
      }
      throw err;
    }

    await this.connections.update(connection.id, {
      accessToken: this.secrets.seal(tokens.access_token, TOKEN_PURPOSE),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      // Microsoft rotates refresh tokens; the newest one lives longest
      ...(tokens.refresh_token ? { refreshToken: this.secrets.seal(tokens.refresh_token, TOKEN_PURPOSE) } : {}),
      lastError: null,
    });
    return tokens.access_token;
  }

  /** Only a new sign-in helps; the profile shows the connection as expired. */
  private async requireReauth(connection: MicrosoftConnection, reason: string): Promise<never> {
    await this.connections.update(connection.id, {
      status: MicrosoftConnectionStatus.ReauthRequired,
      lastError: reason.slice(0, 1000),
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    this.logger.warn(`Microsoft connection of ${connection.email} needs a new sign-in: ${reason}`);
    throw new MicrosoftReauthRequiredError();
  }

  private tryOpen(sealed: string): string | null {
    try {
      return this.secrets.open(sealed, TOKEN_PURPOSE);
    } catch {
      return null;
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetch(`${LOGIN_HOST}/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          scope: SCOPES.join(' '),
          ...params,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new TokenEndpointError(`Microsoft login not reachable: ${(err as Error).message}`, undefined);
    }
    const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      // error_description starts with an AADSTS code that explains the cause
      const description = body.error_description?.split('\r\n')[0] ?? `HTTP ${res.status}`;
      throw new TokenEndpointError(`${body.error ?? 'token_error'}: ${description}`, body.error);
    }
    return body as TokenResponse;
  }

  // ---------- Connection ----------

  connection(userId: string): Promise<MicrosoftConnection | null> {
    return this.connections.findOne({ where: { userId } });
  }

  /**
   * Forgets the tokens. The consent stays in the user's Microsoft account
   * until they remove it there (myapps.microsoft.com); without tokens the
   * CRM cannot use it any more.
   */
  async disconnect(userId: string): Promise<void> {
    await this.connections.delete({ userId });
  }
}

function isAppRejected(err: unknown): boolean {
  return err instanceof TokenEndpointError && err.error === 'invalid_client';
}

/** "https://graph.microsoft.com/Mail.Read openid" → ["mail.read", "openid"] */
function scopesOf(scope: string | undefined): string[] {
  return (scope ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase());
}
