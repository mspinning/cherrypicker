export type SuggestionKind = 'mail' | 'call' | 'offer' | 'meeting';

export type Verdict = 'approve' | 'reject';

export interface Evidence {
  source: string;
  text: string;
  /** 0–100 */
  weight: number;
}

export interface Contact {
  /** Query params that open them under "Kunden"; null if the CRM does not know them */
  link: Record<string, string> | null;
  name: string;
  role: string;
  company: string;
  initials: string;
  avatarColor: string;
}

/** A task as its card on "Heute" shows it, see `toSuggestion`. */
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  kindLabel: string;
  /** Only a call whose contact has a number: the kind badge dials it */
  call?: { number: string; href: string };
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
  /** Can be opened again to read */
  decided: boolean;
  /** Its card is the one on screen */
  shown: boolean;
}

export interface Toast {
  text: string;
  verdict: Verdict;
  /** false for messages that are not about a decision */
  undoable: boolean;
}
