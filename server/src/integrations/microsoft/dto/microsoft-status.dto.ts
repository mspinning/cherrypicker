import { MicrosoftConnectionStatus } from '../microsoft-connection.entity';

export class MicrosoftConnectionDto {
  email: string;
  displayName: string;
  status: MicrosoftConnectionStatus;
  /** Granted delegated scopes, lower case ("mail.read", "calendars.readwrite", …) */
  scopes: string[];
  connectedAt: Date;
  lastError: string | null;
}

export class MicrosoftStatusDto {
  /** false until the server has an app registration and an encryption key */
  configured: boolean;
  /** Environment variables that are still missing */
  missingConfig: string[];
  /** Has to be registered as redirect URI in Entra ID */
  redirectUri: string;
  connection: MicrosoftConnectionDto | null;
}
