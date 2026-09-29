import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EMBEDDING_DIMENSIONS } from '../../config/configuration';
import { GroupCompany } from './group-company.entity';
import { KnowledgeSource } from './knowledge-source.entity';

export interface ChunkMetadata {
  /** First and last PDF page the chunk covers */
  pages?: [number, number];
}

/**
 * A retrieval unit: a few paragraphs of a source plus their embedding.
 * The HNSW (vector) and GIN (full text) indexes are created by
 * KnowledgeIngestionService on startup, TypeORM cannot declare them.
 */
@Entity('knowledge_chunks')
@Index(['sourceId', 'chunkIndex'], { unique: true })
@Index('knowledge_chunks_embedding_hnsw', { synchronize: false })
@Index('knowledge_chunks_content_fts', { synchronize: false })
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @ManyToOne(() => KnowledgeSource, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source?: KnowledgeSource;

  /** Copied from the source, so searches can filter by company without a join */
  @Index()
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => GroupCompany, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: GroupCompany;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: ChunkMetadata;

  /** null until the embedding service has processed the chunk */
  @Column({ type: 'vector', length: EMBEDDING_DIMENSIONS, nullable: true, select: false })
  embedding: number[] | null;

  /** Vectors of different models are not comparable; a model change re-embeds everything. */
  @Column({ name: 'embedding_model', type: 'varchar', length: 200, nullable: true })
  embeddingModel: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
