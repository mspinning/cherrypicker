import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CrmCompany } from '../../crm/entities/crm-company.entity';
import { Task } from '../../tasks/entities/task.entity';
import { User } from '../../users/user.entity';

export enum MailSyncOutcome {
  /** An opportunity: a task with a draft waits on "Heute" */
  Task = 'task',
  /** A new customer or prospect was created, no step needed */
  Customer = 'customer',
  /** From a customer, but nothing to do */
  None = 'none',
  /** Not a customer: vendor, newsletter, private, … */
  Skipped = 'skipped',
  Failed = 'failed',
}

/** crm = already a customer in the CRM, rule = fixed lists, memory = an earlier decision, user = removed with "ignore" */
export type SyncDecider = 'crm' | 'rule' | 'memory' | 'user' | 'llm';

/**
 * One mail the background sync has looked at, and what came of it. The
 * unique index makes the sync repeatable: no mail is ever handled twice.
 * Like the activities, the rows belong to the mailbox owner alone; only
 * sender and subject are kept, never the text.
 */
@Entity('mail_sync_items')
@Index(['userId', 'messageId'], { unique: true })
@Index(['userId', 'receivedAt'])
@Index(['userId', 'conversationId'])
export class MailSyncItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Immutable Graph message id */
  @Column({ name: 'message_id', length: 400 })
  messageId: string;

  @Column({ name: 'conversation_id', type: 'varchar', length: 400, nullable: true })
  conversationId: string | null;

  /** Mails the user sent are only remembered as seen */
  @Column({ type: 'varchar', length: 3 })
  direction: 'in' | 'out';

  @Column({ name: 'from_email', length: 320 })
  fromEmail: string;

  @Column({ name: 'from_name', length: 200, default: '' })
  fromName: string;

  @Column({ length: 500, default: '' })
  subject: string;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'enum', enum: MailSyncOutcome, enumName: 'mail_sync_outcome' })
  outcome: MailSyncOutcome;

  /** customer, prospect, vendor, newsletter, … */
  @Column({ type: 'varchar', length: 30, nullable: true })
  verdict: string | null;

  @Column({ name: 'decided_by', type: 'varchar', length: 10, nullable: true })
  decidedBy: SyncDecider | null;

  /** Why it ended this way, in a sentence for the profile */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** The company was created by this mail */
  @Column({ name: 'customer_created', default: false })
  customerCreated: boolean;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id' })
  task?: Task | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
