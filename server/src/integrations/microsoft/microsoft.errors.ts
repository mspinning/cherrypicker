import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** `code` values of error answers, for clients that react specifically. */
export const MICROSOFT_ERRORS = {
  notConfigured: 'MICROSOFT_NOT_CONFIGURED',
  notConnected: 'MICROSOFT_NOT_CONNECTED',
  reauthRequired: 'MICROSOFT_REAUTH_REQUIRED',
} as const;

export class MicrosoftNotConnectedError extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: MICROSOFT_ERRORS.notConnected,
      message: 'Kein Microsoft-365-Konto verbunden. Verbinde es im Profil.',
    });
  }
}

/** The refresh token was revoked or has expired; only a new sign-in helps. */
export class MicrosoftReauthRequiredError extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: MICROSOFT_ERRORS.reauthRequired,
      message: 'Die Verbindung zu Microsoft 365 ist abgelaufen. Verbinde das Konto im Profil neu.',
    });
  }
}

/** Microsoft rejects the app itself (wrong or expired client secret): only an admin can fix it. */
export class MicrosoftAppConfigError extends ServiceUnavailableException {
  constructor() {
    super({
      statusCode: 503,
      code: MICROSOFT_ERRORS.notConfigured,
      message: 'Microsoft lehnt die App-Registrierung des CRM ab (Client-Secret falsch oder abgelaufen). Ein Admin muss MICROSOFT_CLIENT_SECRET prüfen.',
    });
  }
}

/** Reasons the OAuth callback redirects back with; the client maps them to texts. */
export type MicrosoftAuthFailure =
  | 'denied'
  | 'invalid_state'
  | 'missing_scopes'
  | 'mailbox_taken'
  | 'not_configured'
  | 'app_config'
  | 'failed';

export class MicrosoftAuthError extends Error {
  constructor(
    readonly reason: MicrosoftAuthFailure,
    message: string,
  ) {
    super(message);
  }
}

/** A failed Microsoft Graph call. */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }

  /** For controllers: Graph's 4xx answers keep their meaning, everything else is a gateway problem. */
  toHttp(): HttpException {
    if (this.status === 404) return new NotFoundException('Nicht gefunden (Microsoft 365)');
    if (this.status === 400) return new BadRequestException(`Microsoft 365 lehnt die Anfrage ab: ${this.message}`);
    return new BadGatewayException(`Microsoft 365 antwortet nicht wie erwartet (${this.status})`);
  }
}
