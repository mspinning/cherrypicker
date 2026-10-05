export type TaskKind = 'mail' | 'call' | 'offer' | 'meeting';

export type TaskStatus = 'open' | 'approved' | 'rejected';

export interface TaskEvidence {
  source: string;
  text: string;
  /** 0–100 */
  weight: number;
}

/** One entry of GET /api/tasks: a proposed next step, assigned to the signed-in user */
export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  contactName: string;
  contactRole: string | null;
  companyName: string | null;
  /** As shown on the card, e.g. "48.000 €" */
  dealValue: string | null;
  stage: string | null;
  lastContactAt: string | null;
  /** 0–100 */
  confidence: number;
  /** Best moment to act */
  dueAt: string;
  /** Without "Betreff:" */
  subject: string | null;
  draft: string;
  summary: string;
  evidence: TaskEvidence[];
  /** What happens once it is approved */
  approvalNote: string;
  status: TaskStatus;
  /** Only set if the approved text differs from `draft` */
  finalDraft: string | null;
  decidedAt: string | null;
}
