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
  /** Who the contact is in the CRM, if exactly one person or company fits the name */
  crmContact: { kind: 'person' | 'company'; id: string } | null;
  /** The number for a call, as it is written in the CRM: the person's, else the company's */
  phone: string | null;
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

/** Answer of POST /api/tasks/:id/revise: the task reworked with a hint of its assignee */
export interface TaskRevision {
  task: Task;
  /** Title of the note the hint left on the customer in the CRM; null if nothing of it belonged there */
  crmNote: string | null;
}
