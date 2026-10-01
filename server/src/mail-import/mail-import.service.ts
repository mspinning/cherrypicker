import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subscription } from 'rxjs';
import { In, QueryFailedError, Repository } from 'typeorm';
import { MicrosoftAuthService } from '../integrations/microsoft/microsoft-auth.service';
import { MicrosoftConnectionStatus } from '../integrations/microsoft/microsoft-connection.entity';
import { MicrosoftNotConnectedError, MicrosoftReauthRequiredError } from '../integrations/microsoft/microsoft.errors';
import { MicrosoftEvents } from '../integrations/microsoft/microsoft.events';
import {
  ListGroupsQueryDto,
  MailImportGroupDto,
  MailImportGroupPageDto,
  MailImportJobDto,
  MailImportOverviewDto,
  StartImportDto,
  TEST_LIMITS,
} from './dto/mail-import.dto';
import { MailImportGroup, MailImportGroupStatus } from './entities/mail-import-group.entity';
import { ACTIVE_IMPORT_STATUSES, MailImportJob, MailImportMode, MailImportStatus } from './entities/mail-import-job.entity';
import { MailImportWorker } from './mail-import.worker';
import { RelationshipClassifier } from './relationship-classifier.service';

/** `code` values of error answers. */
export const MAIL_IMPORT_ERRORS = {
  running: 'IMPORT_RUNNING',
  llmMissing: 'LLM_NOT_CONFIGURED',
} as const;

const HISTORY = 5;

/** Starts, lists and cancels mail imports of the signed-in user. */
@Injectable()
export class MailImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailImportService.name);
  private subscription?: Subscription;

  constructor(
    @InjectRepository(MailImportJob) private readonly jobs: Repository<MailImportJob>,
    @InjectRepository(MailImportGroup) private readonly groups: Repository<MailImportGroup>,
    private readonly worker: MailImportWorker,
    private readonly classifier: RelationshipClassifier,
    private readonly auth: MicrosoftAuthService,
    private readonly events: MicrosoftEvents,
  ) {}

  onModuleInit(): void {
    // Without the mailbox a running import cannot continue
    this.subscription = this.events.disconnected$.subscribe((userId) => {
      void this.cancelAll(userId, 'Microsoft-365-Verbindung getrennt').catch((err: Error) =>
        this.logger.error(`Cancelling imports after disconnect failed: ${err.message}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async overview(userId: string): Promise<MailImportOverviewDto> {
    const jobs = await this.jobs.find({ where: { userId }, order: { createdAt: 'DESC' }, take: HISTORY });
    return {
      llmConfigured: this.classifier.configured,
      model: this.classifier.model,
      testLimits: TEST_LIMITS,
      jobs: jobs.map((job) => MailImportJobDto.from(job)),
    };
  }

  async start(userId: string, dto: StartImportDto): Promise<MailImportJobDto> {
    if (!this.classifier.configured) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: MAIL_IMPORT_ERRORS.llmMissing,
        message: 'Auf dem Server ist kein Sprachmodell eingerichtet (LLM_MODEL).',
      });
    }
    const connection = await this.auth.connection(userId);
    if (!connection) throw new MicrosoftNotConnectedError();
    if (connection.status === MicrosoftConnectionStatus.ReauthRequired) throw new MicrosoftReauthRequiredError();

    const test = dto.mode === MailImportMode.Test;
    const since = !test && dto.months ? new Date(Date.now() - dto.months * 30.44 * 86_400_000) : null;
    try {
      const job = await this.jobs.save(
        this.jobs.create({
          userId,
          mode: dto.mode,
          maxMessages: test ? (dto.maxMessages ?? TEST_LIMITS.default) : null,
          since,
          model: this.classifier.model,
          status: MailImportStatus.Queued,
        }),
      );
      this.worker.kick();
      return MailImportJobDto.from(job);
    } catch (err) {
      // Partial unique index: one active import per user
      if (err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23505') {
        throw new ConflictException({
          statusCode: 409,
          code: MAIL_IMPORT_ERRORS.running,
          message: 'Es läuft bereits ein Import. Warte, bis er fertig ist, oder brich ihn ab.',
        });
      }
      throw err;
    }
  }

  async cancel(userId: string, id: string): Promise<MailImportJobDto> {
    const job = await this.findJob(userId, id);
    if (ACTIVE_IMPORT_STATUSES.includes(job.status)) {
      await this.jobs.update(
        { id, status: In(ACTIVE_IMPORT_STATUSES) },
        { status: MailImportStatus.Cancelled, finishedAt: new Date(), error: null },
      );
    }
    return MailImportJobDto.from(await this.findJob(userId, id));
  }

  async listGroups(userId: string, jobId: string, query: ListGroupsQueryDto): Promise<MailImportGroupPageDto> {
    await this.findJob(userId, jobId);
    const qb = this.groups
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.company', 'c')
      .where('g.jobId = :jobId', { jobId })
      .orderBy('g.messageCount', 'DESC')
      .addOrderBy('g.label', 'ASC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 50);
    if (query.status) qb.andWhere('g.status = :status', { status: query.status });

    const [[items, total], counts] = await Promise.all([
      qb.getManyAndCount(),
      this.groups
        .createQueryBuilder('g')
        .select('g.status', 'status')
        .addSelect('count(*)::int', 'n')
        .where('g.job_id = :jobId', { jobId })
        .groupBy('g.status')
        .getRawMany<{ status: MailImportGroupStatus; n: number }>(),
    ]);
    const byStatus = { imported: 0, skipped: 0, failed: 0, pending: 0 };
    for (const row of counts) byStatus[row.status] = row.n;
    return { items: items.map((g) => MailImportGroupDto.from(g)), total, counts: byStatus };
  }

  private async cancelAll(userId: string, reason: string): Promise<void> {
    await this.jobs.update(
      { userId, status: In(ACTIVE_IMPORT_STATUSES) },
      { status: MailImportStatus.Cancelled, finishedAt: new Date(), error: reason },
    );
  }

  private async findJob(userId: string, id: string): Promise<MailImportJob> {
    const job = await this.jobs.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException('Import nicht gefunden');
    return job;
  }
}
