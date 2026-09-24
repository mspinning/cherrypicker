export type SuggestionKind = 'mail' | 'call' | 'offer' | 'meeting';

export type Verdict = 'approve' | 'reject';

export interface Evidence {
  source: string;
  text: string;
  /** 0–100 */
  weight: number;
}

export interface Contact {
  name: string;
  role: string;
  company: string;
  initials: string;
  avatarColor: string;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  kindLabel: string;
  title: string;
  contact: Contact;
  dealValue: string;
  stage: string;
  lastContact: string;
  /** 0–100 */
  confidence: number;
  bestTime: string;
  draftLabel: string;
  subject?: string;
  draft: string;
  summary: string;
  evidence: Evidence[];
  onApprove: string;
  /** Toast after approval, e.g. "Mail an Lena geplant" + "10:00 Uhr" */
  scheduledLabel: string;
  scheduledTime: string;
}

export interface Decision {
  id: string;
  verdict: Verdict;
  edited: boolean;
}

export type QueueStatus = 'approved' | 'edited' | 'rejected' | 'current' | 'waiting';

export interface QueueItem {
  id: string;
  position: string;
  name: string;
  company: string;
  kindLabel: string;
  status: QueueStatus;
  statusLabel: string;
}

export interface Toast {
  text: string;
  verdict: Verdict;
}
