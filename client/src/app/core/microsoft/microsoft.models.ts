export type MicrosoftConnectionStatus = 'active' | 'reauth_required';

export interface MicrosoftConnection {
  email: string;
  displayName: string;
  status: MicrosoftConnectionStatus;
  /** Lower case: "mail.read", "calendars.readwrite", … */
  scopes: string[];
  connectedAt: string;
  lastError: string | null;
}

/** Response of GET /api/integrations/microsoft */
export interface MicrosoftStatus {
  /** false until the server has an app registration and an encryption key */
  configured: boolean;
  missingConfig: string[];
  redirectUri: string;
  connection: MicrosoftConnection | null;
}

export interface CalendarPerson {
  name: string;
  email: string;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  /** ISO, UTC */
  start: string;
  end: string;
  isAllDay: boolean;
  isCancelled: boolean;
  location: string;
  isOnlineMeeting: boolean;
  joinUrl: string | null;
  organizer: CalendarPerson | null;
  attendees: (CalendarPerson & { response: string })[];
  preview: string;
  webLink: string | null;
}

/** Reasons the OAuth callback comes back with (?microsoft=error&reason=…) */
export const CONNECT_ERRORS: Record<string, string> = {
  denied: 'Die Anmeldung bei Microsoft wurde abgebrochen.',
  invalid_state: 'Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser gestartet. Bitte noch einmal verbinden.',
  missing_scopes:
    'Microsoft hat nicht alle Berechtigungen erteilt (Mails lesen, Kalender lesen und schreiben). Eventuell muss ein Administrator der Firma zustimmen.',
  mailbox_taken: 'Dieses Postfach ist bereits mit einem anderen CRM-Konto verbunden.',
  not_configured: 'Microsoft 365 ist auf dem Server noch nicht eingerichtet.',
  app_config:
    'Microsoft lehnt die App-Registrierung des CRM ab: Das Client-Secret ist falsch oder abgelaufen. Ein Admin muss MICROSOFT_CLIENT_SECRET prüfen (der „Wert“ des Secrets, nicht die ID).',
  failed: 'Die Verbindung mit Microsoft 365 ist fehlgeschlagen. Bitte später erneut versuchen.',
};
