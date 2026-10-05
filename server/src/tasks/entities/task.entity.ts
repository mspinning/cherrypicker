import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

/** What the task proposes to do; decides icon, labels and the kind of draft. */
export enum TaskKind {
  Mail = 'mail',
  Call = 'call',
  Offer = 'offer',
  Meeting = 'meeting',
}

export enum TaskStatus {
  Open = 'open',
  Approved = 'approved',
  Rejected = 'rejected',
}

export interface TaskEvidence {
  source: string;
  text: string;
  /** 0–100 */
  weight: number;
}

/**
 * A proposed next step with a customer, assigned to one sales person and
 * shown as a card on "Heute". The person approves it (optionally with an
 * edited draft) or rejects it. Contact and deal are a snapshot for the card,
 * not links into the CRM.
 */
@Entity('tasks')
@Index(['assigneeId', 'status'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The sales person who has to decide */
  @Column({ name: 'assignee_id', type: 'uuid' })
  assigneeId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignee_id' })
  assignee?: User;

  @Column({ type: 'enum', enum: TaskKind, enumName: 'task_kind' })
  kind: TaskKind;

  @Column({ length: 300 })
  title: string;

  @Column({ name: 'contact_name', length: 200 })
  contactName: string;

  @Column({ name: 'contact_role', type: 'varchar', length: 150, nullable: true })
  contactRole: string | null;

  @Column({ name: 'company_name', type: 'varchar', length: 200, nullable: true })
  companyName: string | null;

  /** As shown on the card, e.g. "48.000 €" or "14.400 € / Jahr" */
  @Column({ name: 'deal_value', type: 'varchar', length: 60, nullable: true })
  dealValue: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  stage: string | null;

  @Column({ name: 'last_contact_at', type: 'timestamptz', nullable: true })
  lastContactAt: Date | null;

  /** How sure the suggestion is, 0–100 */
  @Column({ type: 'smallint' })
  confidence: number;

  /** Best moment to act; also the order of the queue */
  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt: Date;

  /** Mail subject, without "Betreff:" */
  @Column({ type: 'varchar', length: 300, nullable: true })
  subject: string | null;

  /** Proposed mail text or call guide */
  @Column({ type: 'text' })
  draft: string;

  /** Why this is proposed */
  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence: TaskEvidence[];

  /** What happens once it is approved, in the user's words */
  @Column({ name: 'approval_note', type: 'text', default: '' })
  approvalNote: string;

  @Column({ type: 'enum', enum: TaskStatus, enumName: 'task_status', default: TaskStatus.Open })
  status: TaskStatus;

  /** The text the assignee approved, if it differs from `draft` */
  @Column({ name: 'final_draft', type: 'text', nullable: true })
  finalDraft: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
