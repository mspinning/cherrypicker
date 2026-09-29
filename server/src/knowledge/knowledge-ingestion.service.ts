import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EmbeddingService } from './embedding.service';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import {
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from './entities/knowledge-source.entity';
import { FileStorageService } from './file-storage.service';
import { chunkText, normalizeText } from './ingestion/chunker';
import {
  decodeText,
  ExtractedText,
  extractFromFile,
  ExtractionError,
  htmlToText,
  pagesOf,
} from './ingestion/text-extractor';
import { fetchPage } from './ingestion/web-fetcher';

const TICK_MS = 20_000;
const EMBED_BATCH = 32;
const INSERT_BATCH = 500;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const EXCERPT_CHARS = 280;

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  [KnowledgeCategory.Service]: 'Leistung',
  [KnowledgeCategory.Offer]: 'Angebot',
  [KnowledgeCategory.Reference]: 'Referenz',
  [KnowledgeCategory.Pricing]: 'Preise',
  [KnowledgeCategory.Company]: 'Unternehmen',
  [KnowledgeCategory.Other]: 'Sonstiges',
};

/**
 * Background worker that turns sources into searchable chunks:
 * extract text → split into chunks → embed via Bifrost.
 *
 * The queue is the knowledge_sources table itself (status `queued`), so it
 * survives restarts without extra infrastructure. Embedding runs separately:
 * if Bifrost is down or no model is set up yet, chunks wait with an empty
 * vector and are picked up again automatically.
 */
@Injectable()
export class KnowledgeIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeIngestionService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private stopped = false;
  private embedBackoffMs = 0;
  private embedBlockedUntil = 0;

  constructor(
    @InjectRepository(KnowledgeSource) private readonly sources: Repository<KnowledgeSource>,
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
    private readonly storage: FileStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureIndexes();

    // Interrupted by a restart
    await this.sources.update({ status: KnowledgeSourceStatus.Processing }, { status: KnowledgeSourceStatus.Queued });

    // Vectors of another model are not comparable with new ones
    const [, staleCount]: [unknown, number] = await this.dataSource.query(
      `UPDATE knowledge_chunks SET embedding = NULL, embedding_model = NULL
       WHERE embedding_model IS NOT NULL AND embedding_model <> $1`,
      [this.embedding.model],
    );
    if (staleCount) {
      this.logger.log(`Embedding model is now ${this.embedding.model}, re-embedding ${staleCount} chunks`);
    }
    await this.dataSource.query(
      `UPDATE knowledge_sources s SET status = $1
       WHERE s.status = $2 AND EXISTS (SELECT 1 FROM knowledge_chunks k WHERE k.source_id = s.id AND k.embedding IS NULL)`,
      [KnowledgeSourceStatus.Embedding, KnowledgeSourceStatus.Ready],
    );

    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.kick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  /** Starts working through the queue; calls while it runs make it loop once more. */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.work().finally(() => (this.running = false));
  }

  /** After Bifrost was fixed: retry embedding now instead of waiting out the backoff. */
  retryEmbeddingNow(): void {
    this.embedBackoffMs = 0;
    this.embedBlockedUntil = 0;
    this.kick();
  }

  private async work(): Promise<void> {
    try {
      do {
        this.again = false;
        // Interleaved, so the first documents of a big upload become searchable early
        while (!this.stopped) {
          const processed = await this.processNext();
          const embedded = await this.embedNextBatch();
          if (!processed && !embedded) break;
        }
      } while (this.again && !this.stopped);
    } catch (err) {
      this.logger.error(`Knowledge worker failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  // ---------- Extraction ----------

  private async processNext(): Promise<boolean> {
    // TypeORM answers UPDATE queries with [rows, affected]
    const [claimed]: [{ id: string }[], number] = await this.dataSource.query(
      `UPDATE knowledge_sources SET status = $1, error = NULL, updated_at = now()
       WHERE id = (
         SELECT id FROM knowledge_sources WHERE status = $2
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [KnowledgeSourceStatus.Processing, KnowledgeSourceStatus.Queued],
    );
    const id = claimed[0]?.id;
    if (!id) return false;

    const source = await this.sources
      .createQueryBuilder('s')
      .addSelect('s.content')
      .where('s.id = :id', { id })
      .getOne();
    if (!source) return true;

    try {
      await this.index(source, await this.extract(source));
    } catch (err) {
      const expected = err instanceof ExtractionError;
      if (!expected) {
        this.logger.error(`Processing source ${id} failed: ${(err as Error).message}`, (err as Error).stack);
      }
      await this.sources.update(
        { id, status: KnowledgeSourceStatus.Processing },
        {
          status: KnowledgeSourceStatus.Failed,
          error: expected ? (err as Error).message : 'Unerwarteter Fehler bei der Verarbeitung.',
        },
      );
    }
    return true;
  }

  private async extract(source: KnowledgeSource): Promise<ExtractedText> {
    switch (source.type) {
      case KnowledgeSourceType.Text:
        return { text: normalizeText(source.content ?? '') };

      case KnowledgeSourceType.Document: {
        if (!source.storageKey || !source.fileName) throw new ExtractionError('Die Datei fehlt.');
        const buffer = await this.storage.read(source.storageKey).catch(() => {
          throw new ExtractionError('Die Datei fehlt im Speicher.');
        });
        return extractFromFile(buffer, source.fileName, source.mimeType);
      }

      case KnowledgeSourceType.Url: {
        const page = await fetchPage(source.url!);
        const isPdf = page.contentType === 'application/pdf' || /\.pdf$/i.test(new URL(page.url).pathname);
        if (isPdf) return extractFromFile(page.body, 'page.pdf');
        if (['text/html', 'application/xhtml+xml', ''].includes(page.contentType)) {
          return htmlToText(decodeText(page.body, page.charset));
        }
        if (page.contentType.startsWith('text/')) {
          return { text: normalizeText(decodeText(page.body, page.charset)) };
        }
        throw new ExtractionError(`Inhalte vom Typ ${page.contentType} werden nicht unterstützt.`);
      }
    }
  }

  /** Replaces the chunks of a source, unless it was edited or deleted meanwhile. */
  private async index(source: KnowledgeSource, extracted: ExtractedText): Promise<void> {
    if (!extracted.text) {
      throw new ExtractionError(
        source.type === KnowledgeSourceType.Url ? 'Auf der Seite wurde kein Text gefunden.' : 'Kein Text gefunden.',
      );
    }

    const chunks = chunkText(extracted.text);

    await this.dataSource.transaction(async (manager) => {
      const updated = await manager
        .createQueryBuilder()
        .update(KnowledgeSource)
        .set({
          // Web pages without a title of their own get the one of the page. SQL, not the
          // loaded value: the title may have been renamed while the page was fetched.
          ...(extracted.title ? { title: () => 'CASE WHEN title = url THEN :pageTitle ELSE title END' } : {}),
          ...(source.type !== KnowledgeSourceType.Text ? { content: extracted.text } : {}),
          excerpt: excerptOf(extracted.text),
          charCount: extracted.text.length,
          pageCount: extracted.pageCount ?? null,
          chunkCount: chunks.length,
          processedAt: new Date(),
          status: KnowledgeSourceStatus.Embedding,
          error: null,
        })
        .where('id = :id AND status = :status', { id: source.id, status: KnowledgeSourceStatus.Processing })
        .setParameter('pageTitle', extracted.title?.slice(0, 300))
        .execute();
      if (!updated.affected) return;

      await manager.delete(KnowledgeChunk, { sourceId: source.id });
      const rows = chunks.map((chunk, index) => {
        const pages = pagesOf(extracted.pageStarts, chunk.start, chunk.end);
        return {
          sourceId: source.id,
          companyId: source.companyId,
          chunkIndex: index,
          content: chunk.content,
          metadata: pages ? { pages } : {},
        };
      });
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await manager.insert(KnowledgeChunk, rows.slice(i, i + INSERT_BATCH));
      }
    });
  }

  // ---------- Embedding ----------

  private async embedNextBatch(): Promise<boolean> {
    if (!this.embedding.configured || Date.now() < this.embedBlockedUntil) return false;

    const batch: {
      id: string;
      source_id: string;
      content: string;
      metadata: { pages?: [number, number] };
      title: string;
      category: KnowledgeCategory;
      company: string;
    }[] = await this.dataSource.query(
      `SELECT k.id, k.source_id, k.content, k.metadata, s.title, s.category, c.name AS company
       FROM knowledge_chunks k
       JOIN knowledge_sources s ON s.id = k.source_id
       JOIN group_companies c ON c.id = k.company_id
       WHERE k.embedding IS NULL AND s.status = $1
       ORDER BY s.created_at, k.chunk_index
       LIMIT $2`,
      [KnowledgeSourceStatus.Embedding, EMBED_BATCH],
    );
    if (!batch.length) return false;

    let vectors: number[][];
    try {
      // A short header gives each chunk its context: "which company, which document"
      vectors = await this.embedding.embed(
        batch.map((row) => {
          const pages = row.metadata?.pages;
          const where = pages ? ` (Seite ${pages[0] === pages[1] ? pages[0] : `${pages[0]}–${pages[1]}`})` : '';
          return `${row.company} · ${CATEGORY_LABELS[row.category]} · ${row.title}${where}\n\n${row.content}`;
        }),
      );
    } catch (err) {
      this.embedBackoffMs = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, this.embedBackoffMs * 2));
      this.embedBlockedUntil = Date.now() + this.embedBackoffMs;
      this.logger.warn(`Embedding paused for ${this.embedBackoffMs / 1000}s: ${(err as Error).message}`);
      return false;
    }
    this.embedBackoffMs = 0;

    await this.dataSource.query(
      `UPDATE knowledge_chunks k SET embedding = v.embedding::vector, embedding_model = $1
       FROM unnest($2::uuid[], $3::text[]) AS v(id, embedding)
       WHERE k.id = v.id`,
      [this.embedding.model, batch.map((row) => row.id), vectors.map((v) => `[${v.join(',')}]`)],
    );
    await this.dataSource.query(
      `UPDATE knowledge_sources s SET status = $1, updated_at = now()
       WHERE s.id = ANY($2::uuid[]) AND s.status = $3
         AND NOT EXISTS (SELECT 1 FROM knowledge_chunks k WHERE k.source_id = s.id AND k.embedding IS NULL)`,
      [KnowledgeSourceStatus.Ready, [...new Set(batch.map((row) => row.source_id))], KnowledgeSourceStatus.Embedding],
    );
    return true;
  }

  // ---------- Schema ----------

  /** Indexes TypeORM cannot declare (see KnowledgeChunk). */
  private async ensureIndexes(): Promise<void> {
    const statements = [
      `CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`,
      `CREATE INDEX IF NOT EXISTS knowledge_chunks_content_fts ON knowledge_chunks USING gin (to_tsvector('german', content))`,
    ];
    for (const sql of statements) {
      try {
        await this.dataSource.query(sql);
      } catch (err) {
        // e.g. HNSW supports at most 2000 dimensions; search still works, just without the index
        this.logger.warn(`Could not create index: ${(err as Error).message}`);
      }
    }
  }
}

export function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), EXCERPT_CHARS - 40))}…`;
}
