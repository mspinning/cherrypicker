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
import { GroupCompany } from './group-company.entity';

export enum KnowledgeSourceType {
  /** Written directly in the CRM */
  Text = 'text',
  /** A web page, fetched by the server */
  Url = 'url',
  /** An uploaded file (past offers, presentations, …) */
  Document = 'document',
}

/** What the source is about, so agents can tell a past offer from a service description. */
export enum KnowledgeCategory {
  Service = 'service',
  Offer = 'offer',
  Reference = 'reference',
  Pricing = 'pricing',
  Company = 'company',
  Other = 'other',
}

/**
 * queued → processing (extract text, chunk) → embedding (vectors) → ready.
 * Extraction errors end in `failed`; embedding errors keep the source in
 * `embedding` and are retried in the background.
 */
export enum KnowledgeSourceStatus {
  Queued = 'queued',
  Processing = 'processing',
  Embedding = 'embedding',
  Ready = 'ready',
  Failed = 'failed',
}

@Entity('knowledge_sources')
@Index(['companyId', 'type', 'createdAt'])
@Index(['status', 'createdAt'])
// The same file or page only once per company
@Index(['companyId', 'fileHash'], { unique: true, where: 'file_hash IS NOT NULL' })
@Index(['companyId', 'url'], { unique: true, where: 'url IS NOT NULL' })
export class KnowledgeSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => GroupCompany, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: GroupCompany;

  @Column({ type: 'enum', enum: KnowledgeSourceType, enumName: 'knowledge_source_type' })
  type: KnowledgeSourceType;

  @Column({ type: 'enum', enum: KnowledgeCategory, enumName: 'knowledge_category', default: KnowledgeCategory.Other })
  category: KnowledgeCategory;

  @Column({ length: 300 })
  title: string;

  /** Text sources: as written. Web pages and documents: the extracted text. */
  @Column({ type: 'text', nullable: true, select: false })
  content: string | null;

  /** Start of the text for list views, so they never load the full content */
  @Column({ type: 'varchar', length: 400, default: '' })
  excerpt: string;

  @Column({ name: 'char_count', type: 'int', default: 0 })
  charCount: number;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 300, nullable: true })
  fileName: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 150, nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  /** sha256 of the uploaded file */
  @Column({ name: 'file_hash', type: 'char', length: 64, nullable: true })
  fileHash: string | null;

  /** Path below the storage directory */
  @Column({ name: 'storage_key', type: 'varchar', length: 300, nullable: true })
  storageKey: string | null;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount: number | null;

  @Column({ type: 'enum', enum: KnowledgeSourceStatus, enumName: 'knowledge_source_status', default: KnowledgeSourceStatus.Queued })
  status: KnowledgeSourceStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'chunk_count', type: 'int', default: 0 })
  chunkCount: number;

  /** Last successful text extraction (for web pages: last fetch) */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
