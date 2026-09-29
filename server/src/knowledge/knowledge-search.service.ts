import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KnowledgeHitDto, KnowledgeSearchResponseDto, SearchKnowledgeDto } from './dto/search.dto';
import { EmbeddingService } from './embedding.service';
import { ChunkMetadata } from './entities/knowledge-chunk.entity';
import { KnowledgeCategory, KnowledgeSourceType } from './entities/knowledge-source.entity';

/** Reciprocal rank fusion constant; 60 is the value from the original paper and works well untuned. */
const RRF_K = 60;

interface HitRow {
  chunk_id: string;
  content: string;
  metadata: ChunkMetadata;
  source_id: string;
  type: KnowledgeSourceType;
  category: KnowledgeCategory;
  title: string;
  url: string | null;
  file_name: string | null;
  company_id: string;
  company_name: string;
  score: number;
  by_semantic: boolean;
  by_keyword: boolean;
}

/**
 * Retrieval for agents: "what does the group offer on topic X?".
 *
 * Hybrid search: pgvector cosine distance finds chunks with the same meaning,
 * German full text search finds exact terms (product names, abbreviations).
 * Both rankings are merged with reciprocal rank fusion. Without an embedding
 * model the keyword half still answers.
 */
@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
  ) {}

  async search(dto: SearchKnowledgeDto): Promise<KnowledgeSearchResponseDto> {
    const limit = dto.limit ?? 8;
    const candidates = Math.max(limit * 5, 40);

    let vector: string | null = null;
    if (this.embedding.configured) {
      try {
        const [embedded] = await this.embedding.embed([dto.query]);
        vector = `[${embedded.join(',')}]`;
      } catch {
        // Bifrost down: keyword search alone is better than no answer
      }
    }

    const rows = await this.dataSource.transaction(async (manager) => {
      // Company and category filters would otherwise thin out the HNSW candidates (pgvector ≥ 0.8)
      await manager.query(`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
      return manager.query<HitRow[]>(
        `WITH q AS (
           -- OR instead of AND: agents ask in full sentences, not every word appears in the text
           SELECT regexp_replace(plainto_tsquery('german', $4)::text, '&|<->', '|', 'g')::tsquery AS query
         ),
         semantic AS (
           SELECT k.id, row_number() OVER (ORDER BY k.embedding <=> $1::vector) AS rank
           FROM knowledge_chunks k JOIN knowledge_sources s ON s.id = k.source_id
           WHERE $1::vector IS NOT NULL AND k.embedding IS NOT NULL
             AND ($2::uuid[] IS NULL OR k.company_id = ANY($2))
             AND ($3::knowledge_category[] IS NULL OR s.category = ANY($3))
           ORDER BY k.embedding <=> $1::vector
           LIMIT $5
         ),
         keyword AS (
           SELECT k.id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('german', k.content), q.query) DESC) AS rank
           FROM knowledge_chunks k JOIN knowledge_sources s ON s.id = k.source_id CROSS JOIN q
           WHERE to_tsvector('german', k.content) @@ q.query
             AND ($2::uuid[] IS NULL OR k.company_id = ANY($2))
             AND ($3::knowledge_category[] IS NULL OR s.category = ANY($3))
           ORDER BY ts_rank_cd(to_tsvector('german', k.content), q.query) DESC
           LIMIT $5
         )
         SELECT k.id AS chunk_id, k.content, k.metadata,
                s.id AS source_id, s.type, s.category, s.title, s.url, s.file_name,
                c.id AS company_id, c.name AS company_name,
                COALESCE(1.0 / (${RRF_K} + sem.rank), 0) + COALESCE(1.0 / (${RRF_K} + kw.rank), 0) AS score,
                sem.rank IS NOT NULL AS by_semantic,
                kw.rank IS NOT NULL AS by_keyword
         FROM semantic sem
         FULL OUTER JOIN keyword kw ON kw.id = sem.id
         JOIN knowledge_chunks k ON k.id = COALESCE(sem.id, kw.id)
         JOIN knowledge_sources s ON s.id = k.source_id
         JOIN group_companies c ON c.id = k.company_id
         ORDER BY score DESC
         LIMIT $6`,
        [vector, dto.companyIds?.length ? dto.companyIds : null, dto.categories?.length ? dto.categories : null, dto.query, candidates, limit],
      );
    });

    return { hits: rows.map(toHit), semantic: vector !== null };
  }
}

function toHit(row: HitRow): KnowledgeHitDto {
  return {
    chunkId: row.chunk_id,
    content: row.content,
    score: Number(row.score),
    matchedBy: [...(row.by_semantic ? ['semantic' as const] : []), ...(row.by_keyword ? ['keyword' as const] : [])],
    pages: row.metadata?.pages ?? null,
    source: {
      id: row.source_id,
      type: row.type,
      category: row.category,
      title: row.title,
      url: row.url,
      fileName: row.file_name,
    },
    company: { id: row.company_id, name: row.company_name },
  };
}
