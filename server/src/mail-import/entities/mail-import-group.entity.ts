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
import { PartyEvidence } from '../../crm/crm-merge.service';
import { CrmCompany } from '../../crm/entities/crm-company.entity';
import { MailImportJob } from './mail-import-job.entity';

export enum MailImportGroupStatus {
  Pending = 'pending',
  /** Customer or prospect, written to the CRM */
  Imported = 'imported',
  /** Vendor, newsletter, internal, unknown, … */
  Skipped = 'skipped',
  Failed = 'failed',
}

/** rule = fixed lists, memory = an earlier decision, user = deleted with "ignore" */
export type GroupDecider = 'rule' | 'memory' | 'user' | 'llm';

/**
 * All mails of one job with one counterpart: a business domain or a single
 * freemail address. The analysis works through these rows, so a restart
 * continues where it stopped; they also explain each decision afterwards.
 */
@Entity('mail_import_groups')
@Index(['jobId', 'key'], { unique: true })
@Index(['jobId', 'status'])
export class MailImportGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => MailImportJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job?: MailImportJob;

  /** "domain:acme.de" or "email:max@gmx.de" (same keys as crm_party_decisions) */
  @Column({ length: 330 })
  key: string;

  /** Registrable business domain; null for freemail */
  @Column({ type: 'varchar', length: 253, nullable: true })
  domain: string | null;

  /** Domain or address, for display */
  @Column({ length: 330 })
  label: string;

  @Column({
    type: 'enum',
    enum: MailImportGroupStatus,
    enumName: 'mail_import_group_status',
    default: MailImportGroupStatus.Pending,
  })
  status: MailImportGroupStatus;

  /** customer, prospect, vendor, newsletter, … */
  @Column({ type: 'varchar', length: 30, nullable: true })
  verdict: string | null;

  @Column({ name: 'decided_by', type: 'varchar', length: 10, nullable: true })
  decidedBy: GroupDecider | null;

  @Column({ type: 'real', nullable: true })
  confidence: number | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  /** As the LLM named it, also for skipped counterparts */
  @Column({ name: 'company_name', type: 'varchar', length: 200, nullable: true })
  companyName: string | null;

  @Column({ name: 'message_count', type: 'int', default: 0 })
  messageCount: number;

  @Column({ name: 'inbound_count', type: 'int', default: 0 })
  inboundCount: number;

  @Column({ name: 'outbound_count', type: 'int', default: 0 })
  outboundCount: number;

  @Column({ name: 'first_at', type: 'timestamptz' })
  firstAt: Date;

  @Column({ name: 'last_at', type: 'timestamptz' })
  lastAt: Date;

  @Column({ type: 'jsonb', default: [] })
  participants: PartyEvidence['participants'];

  /** Newest mails first, capped; headers and preview only */
  @Column({ type: 'jsonb', default: [], select: false })
  messages: PartyEvidence['messages'];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
