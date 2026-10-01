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

export enum MailImportMode {
  /** Only the newest N mails, to check the results before the big run */
  Test = 'test',
  /** Everything since a date (or the whole mailbox) */
  Full = 'full',
}

/**
 * queued → scanning (read mail headers, group by counterpart)
 *        → analyzing (rules, then the LLM per counterpart; write customers)
 *        → done. Failed and cancelled end it early.
 */
export enum MailImportStatus {
  Queued = 'queued',
  Scanning = 'scanning',
  Analyzing = 'analyzing',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export const ACTIVE_IMPORT_STATUSES = [MailImportStatus.Queued, MailImportStatus.Scanning, MailImportStatus.Analyzing];

/** One import run over a user's mailbox. The table is also the worker's queue. */
@Entity('mail_import_jobs')
@Index(['status', 'createdAt'])
// One running import per user, enforced by the database
@Index('mail_import_jobs_one_active_per_user', ['userId'], {
  unique: true,
  where: `status IN ('queued', 'scanning', 'analyzing')`,
})
export class MailImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'enum', enum: MailImportMode, enumName: 'mail_import_mode' })
  mode: MailImportMode;

  @Column({ type: 'enum', enum: MailImportStatus, enumName: 'mail_import_status', default: MailImportStatus.Queued })
  status: MailImportStatus;

  /** Test mode: stop after this many mails (newest first) */
  @Column({ name: 'max_messages', type: 'int', nullable: true })
  maxMessages: number | null;

  /** Full mode: only mails received since; null = the whole mailbox */
  @Column({ type: 'timestamptz', nullable: true })
  since: Date | null;

  @Column({ name: 'messages_scanned', type: 'int', default: 0 })
  messagesScanned: number;

  /** Counterparts found (business domains and private addresses) */
  @Column({ name: 'groups_total', type: 'int', default: 0 })
  groupsTotal: number;

  /** Decided by rules or earlier decisions, without the LLM */
  @Column({ name: 'groups_prefiltered', type: 'int', default: 0 })
  groupsPrefiltered: number;

  @Column({ name: 'groups_analyzed', type: 'int', default: 0 })
  groupsAnalyzed: number;

  @Column({ name: 'groups_imported', type: 'int', default: 0 })
  groupsImported: number;

  @Column({ name: 'groups_failed', type: 'int', default: 0 })
  groupsFailed: number;

  @Column({ name: 'companies_created', type: 'int', default: 0 })
  companiesCreated: number;

  @Column({ name: 'companies_updated', type: 'int', default: 0 })
  companiesUpdated: number;

  @Column({ name: 'contacts_created', type: 'int', default: 0 })
  contactsCreated: number;

  @Column({ name: 'contacts_updated', type: 'int', default: 0 })
  contactsUpdated: number;

  @Column({ name: 'activities_created', type: 'int', default: 0 })
  activitiesCreated: number;

  /** LLM that classified the counterparts */
  @Column({ type: 'varchar', length: 200, nullable: true })
  model: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
