export type MailSyncOutcome = 'task' | 'customer' | 'none' | 'skipped' | 'failed';

export interface MailSyncState {
  /** The user's own switch */
  enabled: boolean;
  /** A check is running right now */
  syncing: boolean;
  lastSyncAt: string | null;
  /** null while switched off */
  nextSyncAt: string | null;
  /** Why the last check stopped early */
  lastError: string | null;
  messagesChecked: number;
  /** Passed over: from own addresses, from colleagues or from automated senders */
  messagesIgnored: number;
  /** Mail domains that count as colleagues */
  internalDomains: string[];
  customersCreated: number;
  tasksCreated: number;
}

/** One mail the background sync looked at and what came of it */
export interface MailSyncItem {
  id: string;
  /** "out": a mail the user sent that brought a new customer into the CRM */
  direction: 'in' | 'out';
  fromName: string;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  outcome: MailSyncOutcome;
  /** customer, prospect, vendor, newsletter, … */
  verdict: string | null;
  reason: string | null;
  customerCreated: boolean;
  company: { id: string; name: string } | null;
  task: { id: string; title: string; status: 'open' | 'approved' | 'rejected' } | null;
}

/** Response of GET /api/mail-sync */
export interface MailSyncOverview {
  /** false: switched off on the server */
  available: boolean;
  llmConfigured: boolean;
  intervalMinutes: number;
  /** null until the mailbox is connected */
  state: MailSyncState | null;
  /** Newest first */
  recent: MailSyncItem[];
}

/** A mail that led to something: a task or a new customer */
export function isHit(item: MailSyncItem): boolean {
  return item.outcome === 'task' || item.outcome === 'customer' || item.customerCreated;
}
