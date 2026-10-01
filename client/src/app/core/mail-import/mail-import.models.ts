export type MailImportMode = 'test' | 'full';
export type MailImportStatus = 'queued' | 'scanning' | 'analyzing' | 'done' | 'failed' | 'cancelled';
export type MailImportGroupStatus = 'pending' | 'imported' | 'skipped' | 'failed';

export interface MailImportJob {
  id: string;
  mode: MailImportMode;
  status: MailImportStatus;
  maxMessages: number | null;
  since: string | null;
  messagesScanned: number;
  groupsTotal: number;
  /** Decided by rules or earlier decisions, without the LLM */
  groupsPrefiltered: number;
  groupsAnalyzed: number;
  groupsImported: number;
  groupsFailed: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  activitiesCreated: number;
  model: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Response of GET /api/mail-import */
export interface MailImportOverview {
  llmConfigured: boolean;
  model: string;
  testLimits: { min: number; max: number; default: number };
  /** Newest first */
  jobs: MailImportJob[];
}

export interface MailImportGroup {
  id: string;
  label: string;
  domain: string | null;
  status: MailImportGroupStatus;
  verdict: string | null;
  decidedBy: 'rule' | 'memory' | 'user' | 'llm' | null;
  confidence: number | null;
  reason: string | null;
  company: { id: string; name: string } | null;
  companyName: string | null;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  lastAt: string;
  people: { email: string; name: string }[];
  error: string | null;
}

export interface MailImportGroupPage {
  items: MailImportGroup[];
  total: number;
  counts: Record<'imported' | 'skipped' | 'failed' | 'pending', number>;
}

export function isActive(job: MailImportJob | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'scanning' || job.status === 'analyzing');
}

export const VERDICT_LABELS: Record<string, string> = {
  customer: 'Kunde',
  prospect: 'Interessent',
  partner: 'Partner',
  vendor: 'Dienstleister',
  notification: 'Benachrichtigung',
  newsletter: 'Newsletter',
  internal: 'Intern',
  private: 'Privat',
  unknown: 'Unklar',
  ignored: 'Ignoriert',
};

export function verdictLabel(verdict: string | null): string {
  return verdict ? (VERDICT_LABELS[verdict] ?? verdict) : '–';
}
