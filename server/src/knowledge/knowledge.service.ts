import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { UsersService } from '../users/users.service';
import { CompanyResponseDto, CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import {
  CreateTextSourceDto,
  CreateUrlSourcesDto,
  CreateUrlSourcesResponseDto,
  ListSourcesQueryDto,
  SourcePageDto,
  SourceResponseDto,
  UpdateSourceDto,
} from './dto/source.dto';
import { EmbeddingService, EmbeddingState } from './embedding.service';
import { GroupCompany } from './entities/group-company.entity';
import {
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from './entities/knowledge-source.entity';
import { FileStorageService } from './file-storage.service';
import { formatOf } from './ingestion/text-extractor';
import { normalizeUrl } from './ingestion/web-fetcher';
import { excerptOf, KnowledgeIngestionService } from './knowledge-ingestion.service';

/** `code` values of 409 answers, for clients that react specifically. */
export const KNOWLEDGE_ERRORS = {
  duplicateCompany: 'DUPLICATE_COMPANY',
  duplicateFile: 'DUPLICATE_FILE',
  unsupportedFile: 'UNSUPPORTED_FILE',
} as const;

const PENDING = [KnowledgeSourceStatus.Queued, KnowledgeSourceStatus.Processing, KnowledgeSourceStatus.Embedding];

export interface KnowledgeOverview {
  companies: CompanyResponseDto[];
  embedding: EmbeddingState & { pendingChunks: number };
}

/** Group companies and their knowledge sources (texts, web pages, documents). */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @InjectRepository(GroupCompany) private readonly companies: Repository<GroupCompany>,
    @InjectRepository(KnowledgeSource) private readonly sources: Repository<KnowledgeSource>,
    private readonly dataSource: DataSource,
    private readonly storage: FileStorageService,
    private readonly ingestion: KnowledgeIngestionService,
    private readonly embedding: EmbeddingService,
    private readonly users: UsersService,
  ) {}

  // ---------- Companies ----------

  async overview(): Promise<KnowledgeOverview> {
    const [companies, stats, chunkStats] = await Promise.all([
      this.companies.find({ order: { name: 'ASC' } }),
      this.dataSource.query<{ company_id: string; type: KnowledgeSourceType; status: KnowledgeSourceStatus; n: number }[]>(
        `SELECT company_id, type, status, count(*)::int AS n FROM knowledge_sources GROUP BY 1, 2, 3`,
      ),
      this.dataSource.query<{ company_id: string; chunks: number; embedded: number; waiting: number }[]>(
        `SELECT k.company_id, count(*)::int AS chunks, count(k.embedding)::int AS embedded,
                count(*) FILTER (WHERE k.embedding IS NULL AND s.status = $1)::int AS waiting
         FROM knowledge_chunks k JOIN knowledge_sources s ON s.id = k.source_id
         GROUP BY 1`,
        [KnowledgeSourceStatus.Embedding],
      ),
    ]);

    const byCompany = new Map(companies.map((c) => [c.id, CompanyResponseDto.from(c)]));
    for (const row of stats) {
      const dto = byCompany.get(row.company_id);
      if (!dto) continue;
      dto.counts[row.type] += row.n;
      if (PENDING.includes(row.status)) dto.pending += row.n;
      if (row.status === KnowledgeSourceStatus.Failed) dto.failed += row.n;
    }
    let pendingChunks = 0;
    for (const row of chunkStats) {
      const dto = byCompany.get(row.company_id);
      if (!dto) continue;
      dto.chunks = row.chunks;
      dto.embeddedChunks = row.embedded;
      pendingChunks += row.waiting;
    }

    return {
      companies: [...byCompany.values()],
      embedding: { ...this.embedding.state(), pendingChunks },
    };
  }

  async createCompany(dto: CreateCompanyDto): Promise<CompanyResponseDto> {
    await this.ensureUniqueName(dto.name);
    const company = await this.companies.save(
      this.companies.create({ name: dto.name, description: dto.description ?? '' }),
    );
    return CompanyResponseDto.from(company);
  }

  async updateCompany(id: string, dto: UpdateCompanyDto): Promise<GroupCompany> {
    const company = await this.findCompany(id);
    if (dto.name !== undefined && dto.name !== company.name) {
      await this.ensureUniqueName(dto.name, id);
      company.name = dto.name;
    }
    if (dto.description !== undefined) company.description = dto.description;
    return this.companies.save(company);
  }

  /** Removes all sources, chunks (FK cascade) and uploaded files of the company. */
  async removeCompany(id: string): Promise<void> {
    await this.findCompany(id);
    await this.companies.delete(id);
    await this.storage.remove(`knowledge/${id}`);
  }

  // ---------- Sources ----------

  async listSources(companyId: string, query: ListSourcesQueryDto): Promise<SourcePageDto> {
    await this.findCompany(companyId);
    const qb = this.sources
      .createQueryBuilder('s')
      .where('s.company_id = :companyId', { companyId })
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 50);

    if (query.type) qb.andWhere('s.type = :type', { type: query.type });
    if (query.category) qb.andWhere('s.category = :category', { category: query.category });
    if (query.state === 'pending') qb.andWhere('s.status IN (:...pending)', { pending: PENDING });
    if (query.state === 'failed') qb.andWhere('s.status = :failed', { failed: KnowledgeSourceStatus.Failed });
    if (query.state === 'ready') qb.andWhere('s.status = :ready', { ready: KnowledgeSourceStatus.Ready });
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(
        new Brackets((w) =>
          w.where('s.title ILIKE :like', { like }).orWhere('s.file_name ILIKE :like').orWhere('s.url ILIKE :like'),
        ),
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((s) => SourceResponseDto.from(s)), total };
  }

  async getSource(id: string): Promise<SourceResponseDto> {
    return SourceResponseDto.from(await this.findSource(id, true), true);
  }

  async createText(companyId: string, dto: CreateTextSourceDto, actor: AuthenticatedUser): Promise<SourceResponseDto> {
    await this.findCompany(companyId);
    const source = await this.sources.save(
      this.sources.create({
        companyId,
        type: KnowledgeSourceType.Text,
        category: dto.category,
        title: dto.title,
        content: dto.content,
        excerpt: excerptOf(dto.content),
        charCount: dto.content.length,
        createdById: await this.actorId(actor),
      }),
    );
    this.ingestion.kick();
    return SourceResponseDto.from(source);
  }

  /** Stores the URLs; the worker fetches them in the background. */
  async createUrls(
    companyId: string,
    dto: CreateUrlSourcesDto,
    actor: AuthenticatedUser,
  ): Promise<CreateUrlSourcesResponseDto> {
    await this.findCompany(companyId);
    const invalid: string[] = [];
    const wanted = new Map<string, string>();
    const duplicates: string[] = [];
    for (const raw of dto.urls.map((u) => u.trim()).filter(Boolean)) {
      const url = normalizeUrl(raw);
      if (!url) invalid.push(raw);
      else if (wanted.has(url)) duplicates.push(raw);
      else wanted.set(url, raw);
    }

    const existing = wanted.size
      ? await this.sources.find({ select: { url: true }, where: { companyId, url: In([...wanted.keys()]) } })
      : [];
    const known = new Set(existing.map((s) => s.url));
    duplicates.push(...[...wanted].filter(([url]) => known.has(url)).map(([, raw]) => raw));
    const fresh = [...wanted.keys()].filter((url) => !known.has(url));

    const createdById = await this.actorId(actor);
    const created = fresh.length
      ? await this.sources.save(
          fresh.map((url) =>
            this.sources.create({
              companyId,
              type: KnowledgeSourceType.Url,
              category: dto.category,
              // Replaced by the page title once fetched
              title: url.slice(0, 300),
              url,
              createdById,
            }),
          ),
        )
      : [];
    if (created.length) this.ingestion.kick();

    return { created: created.map((s) => SourceResponseDto.from(s)), duplicates, invalid };
  }

  async uploadDocument(
    companyId: string,
    file: Express.Multer.File | undefined,
    category: KnowledgeCategory,
    actor: AuthenticatedUser,
  ): Promise<SourceResponseDto> {
    await this.findCompany(companyId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Keine Datei oder eine leere Datei empfangen');
    }
    const fileName = decodeFileName(file.originalname);
    if (!formatOf(fileName, file.mimetype)) {
      throw new BadRequestException({
        statusCode: 400,
        code: KNOWLEDGE_ERRORS.unsupportedFile,
        message: 'Unterstützt werden PDF, Word (.docx), Text, Markdown, CSV und HTML',
      });
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.sources.findOne({ where: { companyId, fileHash } });
    if (duplicate) throw this.duplicateFile(duplicate);

    const source = this.sources.create({
      companyId,
      type: KnowledgeSourceType.Document,
      category,
      title: titleFromFileName(fileName),
      fileName,
      mimeType: file.mimetype || null,
      fileSize: file.size,
      fileHash,
      createdById: await this.actorId(actor),
    });
    // Save first to get the id, the file is named after it
    try {
      await this.sources.save(source);
    } catch (err) {
      // Two parallel uploads of the same file
      if (err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23505') {
        const winner = await this.sources.findOne({ where: { companyId, fileHash } });
        if (winner) throw this.duplicateFile(winner);
      }
      throw err;
    }

    const storageKey = `knowledge/${companyId}/${source.id}${extname(fileName).toLowerCase()}`;
    try {
      await this.storage.write(storageKey, file.buffer);
    } catch (err) {
      await this.sources.delete(source.id);
      this.logger.error(`Storing ${fileName} failed: ${(err as Error).message}`);
      throw err;
    }
    await this.sources.update(source.id, { storageKey });
    source.storageKey = storageKey;

    this.ingestion.kick();
    return SourceResponseDto.from(source);
  }

  async updateSource(id: string, dto: UpdateSourceDto): Promise<SourceResponseDto> {
    const source = await this.findSource(id, true);
    if (dto.content !== undefined && source.type !== KnowledgeSourceType.Text) {
      throw new BadRequestException('Nur bei eigenen Texten lässt sich der Inhalt ändern');
    }

    const contentChanged = dto.content !== undefined && dto.content !== source.content;
    // Title and category are part of every embedded chunk
    const contextChanged =
      (dto.title !== undefined && dto.title !== source.title) ||
      (dto.category !== undefined && dto.category !== source.category);
    source.title = dto.title ?? source.title;
    source.category = dto.category ?? source.category;
    if (contentChanged) {
      source.content = dto.content!;
      source.excerpt = excerptOf(dto.content!);
      source.charCount = dto.content!.length;
      source.status = KnowledgeSourceStatus.Queued;
      source.error = null;
    }
    const reembed =
      !contentChanged &&
      contextChanged &&
      [KnowledgeSourceStatus.Ready, KnowledgeSourceStatus.Embedding].includes(source.status);
    if (reembed) source.status = KnowledgeSourceStatus.Embedding;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(source);
      if (reembed) {
        await manager.query(`UPDATE knowledge_chunks SET embedding = NULL, embedding_model = NULL WHERE source_id = $1`, [id]);
      }
    });
    if (contentChanged || reembed) this.ingestion.kick();
    return SourceResponseDto.from(source);
  }

  /** Fetches web pages again, re-reads documents; also the retry after a failure. */
  async reprocess(id: string): Promise<SourceResponseDto> {
    const source = await this.findSource(id);
    source.status = KnowledgeSourceStatus.Queued;
    source.error = null;
    await this.sources.save(source);
    this.ingestion.kick();
    return SourceResponseDto.from(source);
  }

  async reprocessFailed(companyId: string): Promise<number> {
    await this.findCompany(companyId);
    const result = await this.sources.update(
      { companyId, status: KnowledgeSourceStatus.Failed },
      { status: KnowledgeSourceStatus.Queued, error: null },
    );
    if (result.affected) this.ingestion.kick();
    return result.affected ?? 0;
  }

  async removeSource(id: string): Promise<void> {
    const source = await this.findSource(id);
    await this.sources.delete(id);
    if (source.storageKey) await this.storage.remove(source.storageKey);
  }

  async readFile(id: string): Promise<{ source: KnowledgeSource; data: Buffer }> {
    const source = await this.findSource(id);
    if (!source.storageKey) throw new NotFoundException('Diese Quelle hat keine Datei');
    const data = await this.storage.read(source.storageKey).catch(() => {
      throw new NotFoundException('Die Datei fehlt im Speicher');
    });
    return { source, data };
  }

  retryEmbedding(): void {
    this.ingestion.retryEmbeddingNow();
  }

  // ---------- Helpers ----------

  private async findCompany(id: string): Promise<GroupCompany> {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Firma nicht gefunden');
    return company;
  }

  private async findSource(id: string, withContent = false): Promise<KnowledgeSource> {
    const qb = this.sources.createQueryBuilder('s').where('s.id = :id', { id });
    if (withContent) qb.addSelect('s.content');
    const source = await qb.getOne();
    if (!source) throw new NotFoundException('Quelle nicht gefunden');
    return source;
  }

  private async ensureUniqueName(name: string, exceptId?: string): Promise<void> {
    const qb = this.companies.createQueryBuilder('c').where('lower(c.name) = lower(:name)', { name });
    if (exceptId) qb.andWhere('c.id <> :exceptId', { exceptId });
    if (await qb.getExists()) {
      throw new ConflictException({
        statusCode: 409,
        code: KNOWLEDGE_ERRORS.duplicateCompany,
        message: 'Eine Firma mit diesem Namen gibt es schon',
      });
    }
  }

  private duplicateFile(existing: KnowledgeSource): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: KNOWLEDGE_ERRORS.duplicateFile,
      message: `Diese Datei ist schon vorhanden: ${existing.fileName ?? existing.title}`,
      sourceId: existing.id,
    });
  }

  private async actorId(actor: AuthenticatedUser): Promise<string | null> {
    return (await this.users.findByKeycloakId(actor.sub))?.id ?? null;
  }
}

/**
 * Browsers send UTF-8 file names; multer is configured for that, but a
 * latin1-decoded name ("MÃ¼ller.pdf") is repaired here just in case.
 */
function decodeFileName(name: string): string {
  if (/[^\u0000-ÿ]/.test(name)) return name.normalize('NFC');
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return (utf8.includes('�') ? name : utf8).normalize('NFC');
}

/** "Angebot_Müller-GmbH_2024.pdf" → "Angebot Müller-GmbH 2024" */
function titleFromFileName(fileName: string): string {
  const base = fileName.slice(0, fileName.length - extname(fileName).length);
  return (base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || fileName).slice(0, 300);
}
