import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { CrmMergeService, MergeResult } from '../crm/crm-merge.service';
import { CrmRelationship } from '../crm/entities/crm-company.entity';
import { CrmPartyDecision, PartyDecider } from '../crm/entities/crm-party-decision.entity';
import { GraphClient } from '../integrations/microsoft/graph-client.service';
import { MicrosoftAuthService } from '../integrations/microsoft/microsoft-auth.service';
import {
  GraphError,
  MicrosoftAppConfigError,
  MicrosoftNotConnectedError,
  MicrosoftReauthRequiredError,
} from '../integrations/microsoft/microsoft.errors';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { LlmError } from '../llm/llm.service';
import { User } from '../users/user.entity';
import { cleanAddress, domainOf, isFreemail, isKnownService, registrableDomain } from './addresses';
import { MailImportGroup, MailImportGroupStatus } from './entities/mail-import-group.entity';
import { MailImportJob, MailImportStatus } from './entities/mail-import-job.entity';
import { MailAggregator, MailGroup } from './mail-aggregator';
import {
  ClassifierContext,
  isCustomerVerdict,
  MIN_CONFIDENCE,
  pickMessages,
  promptTexts,
  RelationshipClassifier,
} from './relationship-classifier.service';

const TICK_MS = 15_000;
const MAX_PARALLEL_JOBS = 2;
/** Counterparts analysed at the same time within one job */
const ANALYZE_CONCURRENCY = 3;
const PAGE_SIZE = 100;
const INSERT_BATCH = 200;
/** Several counterparts in a row failing points to the LLM, not to the mails */
const MAX_FAILURES_IN_A_ROW = 4;
/** Earlier non-customer decisions are trusted unless there is now much more mail */
const MEMORY_CONFIDENCE = 0.75;
/** Junk, trash and unsent mail say nothing about customers */
const SKIP_FOLDERS = ['junkemail', 'deleteditems', 'drafts', 'outbox'];

type Counter =
  | 'groupsAnalyzed'
  | 'groupsImported'
  | 'groupsFailed'
  | 'companiesCreated'
  | 'companiesUpdated'
  | 'contactsCreated'
  | 'contactsUpdated'
  | 'activitiesCreated';

const COUNTER_COLUMNS: Record<Counter, string> = {
  groupsAnalyzed: 'groups_analyzed',
  groupsImported: 'groups_imported',
  groupsFailed: 'groups_failed',
  companiesCreated: 'companies_created',
  companiesUpdated: 'companies_updated',
  contactsCreated: 'contacts_created',
  contactsUpdated: 'contacts_updated',
  activitiesCreated: 'activities_created',
};

class JobStopped extends Error {}

/**
 * Background worker for mail imports. The job table is the queue (claimed
 * with SKIP LOCKED); scans start over after a restart, analyses continue with
 * the counterparts still pending.
 */
@Injectable()
export class MailImportWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailImportWorker.name);
  private readonly running = new Set<string>();
  private readonly internalDomains: string[];
  private timer?: NodeJS.Timeout;
  private claiming = false;
  private stopped = false;

  constructor(
    @InjectRepository(MailImportJob) private readonly jobs: Repository<MailImportJob>,
    @InjectRepository(MailImportGroup) private readonly groups: Repository<MailImportGroup>,
    @InjectRepository(CrmPartyDecision) private readonly decisions: Repository<CrmPartyDecision>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GroupCompany) private readonly groupCompanies: Repository<GroupCompany>,
    private readonly dataSource: DataSource,
    private readonly graph: GraphClient,
    private readonly auth: MicrosoftAuthService,
    private readonly classifier: RelationshipClassifier,
    private readonly merger: CrmMergeService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.internalDomains = config.get('mailImport', { infer: true }).internalDomains.map(registrableDomain);
  }

  async onApplicationBootstrap(): Promise<void> {
    // An interrupted scan has nothing saved yet: start it over
    const interrupted = await this.jobs.find({ select: { id: true }, where: { status: MailImportStatus.Scanning } });
    if (interrupted.length) {
      await this.groups.delete({ jobId: In(interrupted.map((j) => j.id)) });
      await this.jobs.update({ id: In(interrupted.map((j) => j.id)) }, { status: MailImportStatus.Queued, messagesScanned: 0 });
    }
    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.kick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  /** Picks up queued jobs (and analyses interrupted by a restart) while there is room. */
  kick(): void {
    if (this.claiming || this.stopped) return;
    this.claiming = true;
    void this.fill()
      .catch((err: Error) => this.logger.error(`Claiming mail import jobs failed: ${err.message}`))
      .finally(() => (this.claiming = false));
  }

  private async fill(): Promise<void> {
    while (this.running.size < MAX_PARALLEL_JOBS && !this.stopped) {
      const [claimed]: [{ id: string }[], number] = await this.dataSource.query(
        `UPDATE mail_import_jobs
         SET status = CASE WHEN status = $1 THEN $2::mail_import_status ELSE status END,
             started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = (
           SELECT id FROM mail_import_jobs
           WHERE status IN ($1, $3) AND NOT (id = ANY($4::uuid[]))
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id`,
        [MailImportStatus.Queued, MailImportStatus.Scanning, MailImportStatus.Analyzing, [...this.running]],
      );
      const id = claimed[0]?.id;
      if (!id) return;
      this.running.add(id);
      void this.run(id).finally(() => {
        this.running.delete(id);
        this.kick();
      });
    }
  }

  private async run(id: string): Promise<void> {
    try {
      let job = await this.jobs.findOneByOrFail({ id });
      if (job.status === MailImportStatus.Scanning) {
        await this.scan(job);
        job = await this.jobs.findOneByOrFail({ id });
      }
      if (job.status === MailImportStatus.Analyzing) await this.analyze(job);
    } catch (err) {
      if (err instanceof JobStopped) return;
      const message = userMessage(err);
      if (!(err instanceof LlmError || isMailboxProblem(err))) {
        this.logger.error(`Mail import ${id} failed: ${(err as Error).message}`, (err as Error).stack);
      }
      await this.jobs.update(
        { id, status: In([MailImportStatus.Scanning, MailImportStatus.Analyzing]) },
        { status: MailImportStatus.Failed, error: message, finishedAt: new Date() },
      );
    }
  }

  // ---------- Scan ----------

  /** Reads all mail headers (newest first) and groups them by counterpart. */
  private async scan(job: MailImportJob): Promise<void> {
    const ctx = await this.scanContext(job.userId);
    const skipFolders = await this.graph.folderIds(job.userId, SKIP_FOLDERS);
    const aggregator = new MailAggregator(ctx);

    let scanned = 0;
    pages: for await (const page of this.graph.messages(job.userId, { since: job.since, pageSize: PAGE_SIZE })) {
      for (const message of page) {
        if (message.isDraft || (message.parentFolderId && skipFolders.has(message.parentFolderId))) continue;
        aggregator.add(message);
        scanned++;
        if (job.maxMessages && scanned >= job.maxMessages) break pages;
      }
      await this.jobs.update(job.id, { messagesScanned: scanned });
      await this.ensureRunning(job.id);
    }

    const found = aggregator.result();
    const decisions = await this.decisionsFor(found.map((g) => g.key));
    const rows = found.map((group) => this.prefilter(job.id, group, decisions.get(group.key)));
    const prefiltered = rows.filter((r) => r.status !== MailImportGroupStatus.Pending).length;

    await this.dataSource.transaction(async (m) => {
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await m.insert(MailImportGroup, rows.slice(i, i + INSERT_BATCH));
      }
      const updated = await m.update(
        MailImportJob,
        { id: job.id, status: MailImportStatus.Scanning },
        { status: MailImportStatus.Analyzing, messagesScanned: scanned, groupsTotal: rows.length, groupsPrefiltered: prefiltered },
      );
      // Cancelled meanwhile: keep nothing
      if (!updated.affected) throw new JobStopped();
    });
    this.logger.log(`Mail import ${job.id}: ${scanned} mails, ${rows.length} counterparts, ${prefiltered} decided by rules`);
  }

  /** Own addresses and the group's domains: neither ever becomes a customer. */
  private async scanContext(userId: string): Promise<{ ownAddresses: Set<string>; internalDomains: Set<string> }> {
    const [me, connection, users] = await Promise.all([
      this.graph.me(userId),
      this.auth.connection(userId),
      this.users.find({ select: { email: true } }),
    ]);
    const own = new Set(
      [
        me.mail,
        me.userPrincipalName,
        connection?.email,
        ...(me.otherMails ?? []),
        // "SMTP:max@acme.de" (primary) and "smtp:alias@acme.de"
        ...(me.proxyAddresses ?? []).filter((a) => /^smtp:/i.test(a)).map((a) => a.slice(5)),
      ]
        .map((a) => cleanAddress(a))
        .filter((a): a is string => !!a),
    );
    // Freemail domains of colleagues must not hide every gmail customer
    const internal = new Set(
      [...own, ...users.map((u) => u.email)]
        .map((a) => registrableDomain(domainOf(a)))
        .filter((d) => d && !isFreemail(d))
        .concat(this.internalDomains),
    );
    return { ownAddresses: own, internalDomains: internal };
  }

  private async decisionsFor(keys: string[]): Promise<Map<string, CrmPartyDecision>> {
    const result = new Map<string, CrmPartyDecision>();
    for (let i = 0; i < keys.length; i += 1000) {
      for (const d of await this.decisions.findBy({ key: In(keys.slice(i, i + 1000)) })) result.set(d.key, d);
    }
    return result;
  }

  /** Rules and earlier decisions that settle a counterpart without the LLM. */
  private prefilter(jobId: string, g: MailGroup, decision: CrmPartyDecision | undefined): Partial<MailImportGroup> {
    const row: Partial<MailImportGroup> = {
      jobId,
      key: g.key,
      domain: g.domain,
      label: g.label,
      status: MailImportGroupStatus.Pending,
      messageCount: g.messageCount,
      inboundCount: g.inbound,
      outboundCount: g.outbound,
      firstAt: new Date(g.firstAt),
      lastAt: new Date(g.lastAt),
      participants: [...g.participants.values()],
      messages: g.messages,
    };
    const skip = (verdict: string, decidedBy: MailImportGroup['decidedBy'], reason: string, confidence = 1) =>
      Object.assign(row, { status: MailImportGroupStatus.Skipped, verdict, decidedBy, reason, confidence });

    if (decision?.decidedBy === PartyDecider.User) return skip(decision.verdict, 'user', decision.reason);
    if (g.domain && isKnownService(g.domain)) return skip('vendor', 'rule', 'Bekannter Dienst oder Anbieter');
    if (g.outbound === 0 && g.otherInbound >= Math.max(1, g.inbound * 0.8)) {
      return skip('newsletter', 'rule', 'Nur eingehende Mails, von Outlook unter „Sonstige“ einsortiert');
    }
    if (
      decision &&
      !isCustomerVerdict(decision.verdict) &&
      decision.confidence >= MEMORY_CONFIDENCE &&
      g.messageCount <= decision.messageCount * 2
    ) {
      return skip(decision.verdict, 'memory', decision.reason, decision.confidence);
    }
    return row;
  }

  // ---------- Analysis ----------

  private async analyze(job: MailImportJob): Promise<void> {
    const ctx = await this.classifierContext(job.userId);
    let failuresInARow = 0;
    let lastFailure = '';

    for (;;) {
      await this.ensureRunning(job.id);
      const batch = await this.groups
        .createQueryBuilder('g')
        .addSelect('g.messages')
        .where('g.job_id = :jobId AND g.status = :pending', { jobId: job.id, pending: MailImportGroupStatus.Pending })
        .orderBy('g.message_count', 'DESC')
        .addOrderBy('g.id')
        .limit(ANALYZE_CONCURRENCY)
        .getMany();
      if (!batch.length) break;

      // allSettled: a fatal error must not leave the other counterparts writing in the background
      const outcomes = await Promise.allSettled(batch.map((group) => this.analyzeGroup(job, ctx, group)));
      const fatal = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
      if (fatal) throw fatal.reason;
      for (const outcome of outcomes as PromiseFulfilledResult<true | string>[]) {
        if (outcome.value === true) failuresInARow = 0;
        else {
          failuresInARow++;
          lastFailure = outcome.value;
        }
      }
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        throw new LlmError(`Mehrere Gegenseiten in Folge ließen sich nicht auswerten: ${lastFailure}`, true);
      }
    }

    await this.jobs.update(
      { id: job.id, status: MailImportStatus.Analyzing },
      { status: MailImportStatus.Done, finishedAt: new Date() },
    );
    const done = await this.jobs.findOneBy({ id: job.id });
    this.logger.log(
      `Mail import ${job.id} done: ${done?.groupsImported ?? 0} customers, ${done?.companiesCreated ?? 0} new companies, ${done?.contactsCreated ?? 0} new contacts`,
    );
  }

  /** true when decided; otherwise the reason it failed. Job-level problems are thrown. */
  private async analyzeGroup(job: MailImportJob, ctx: ClassifierContext, group: MailImportGroup): Promise<true | string> {
    try {
      const picked = pickMessages(group.messages);
      const texts = promptTexts(await this.graph.messageTexts(job.userId, picked.map((m) => m.id)));
      const assessment = await this.classifier.assess(
        ctx,
        {
          domain: group.domain,
          label: group.label,
          inbound: group.inboundCount,
          outbound: group.outboundCount,
          firstAt: group.firstAt,
          lastAt: group.lastAt,
          participants: group.participants,
          messages: group.messages,
        },
        texts,
      );

      const relationship = assessment.confidence >= MIN_CONFIDENCE ? relationshipOf(assessment.verdict) : null;
      const relevant = relationship !== null;
      let merge: MergeResult | null = null;
      if (relationship) {
        merge = await this.merger.merge(
          { userId: job.userId, domain: group.domain, participants: group.participants, messages: group.messages },
          { relationship, ...assessment.facts },
        );
      }

      await this.groups.update(group.id, {
        status: relevant ? MailImportGroupStatus.Imported : MailImportGroupStatus.Skipped,
        verdict: assessment.verdict,
        decidedBy: 'llm',
        confidence: assessment.confidence,
        reason: assessment.reason || null,
        companyId: merge?.companyId ?? null,
        companyName: assessment.facts.company?.name ?? null,
        error: null,
      });
      await this.decisions.upsert(
        {
          key: group.key,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          reason: assessment.reason,
          decidedBy: PartyDecider.Llm,
          messageCount: group.messageCount,
          companyId: merge?.companyId ?? null,
        },
        ['key'],
      );
      await this.count(job.id, {
        groupsAnalyzed: 1,
        groupsImported: relevant ? 1 : 0,
        companiesCreated: merge?.companyCreated ? 1 : 0,
        companiesUpdated: merge && !merge.companyCreated && merge.companyUpdated ? 1 : 0,
        contactsCreated: merge?.contactsCreated ?? 0,
        contactsUpdated: merge?.contactsUpdated ?? 0,
        activitiesCreated: merge?.activitiesCreated ?? 0,
      });
      return true;
    } catch (err) {
      if ((err instanceof LlmError && err.fatal) || isMailboxProblem(err)) throw err;
      const message = userMessage(err);
      if (!(err instanceof LlmError || err instanceof GraphError)) {
        this.logger.error(`Analysing ${group.label} failed: ${(err as Error).message}`, (err as Error).stack);
      }
      await this.groups.update(group.id, { status: MailImportGroupStatus.Failed, error: message.slice(0, 1000) });
      await this.count(job.id, { groupsAnalyzed: 1, groupsFailed: 1 });
      return message;
    }
  }

  private async classifierContext(userId: string): Promise<ClassifierContext> {
    const [user, connection, companies] = await Promise.all([
      this.users.findOneByOrFail({ id: userId }),
      this.auth.connection(userId),
      this.groupCompanies.find({ order: { name: 'ASC' } }),
    ]);
    return {
      ownerName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      ownerEmail: connection?.email ?? user.email,
      groupCompanies: companies.map((c) => ({ name: c.name, description: c.description })),
    };
  }

  // ---------- Helpers ----------

  /** Stops quietly when the job was cancelled (or the connection removed) meanwhile. */
  private async ensureRunning(id: string): Promise<void> {
    const job = await this.jobs.findOne({ select: { status: true }, where: { id } });
    if (!job || ![MailImportStatus.Scanning, MailImportStatus.Analyzing].includes(job.status) || this.stopped) {
      throw new JobStopped();
    }
  }

  /** Atomic increments: several counterparts finish at the same time. */
  private async count(id: string, deltas: Partial<Record<Counter, number>>): Promise<void> {
    const entries = Object.entries(deltas).filter(([, n]) => n) as [Counter, number][];
    if (!entries.length) return;
    const sets = entries.map(([key], i) => `${COUNTER_COLUMNS[key]} = ${COUNTER_COLUMNS[key]} + $${i + 2}`);
    await this.dataSource.query(`UPDATE mail_import_jobs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [
      id,
      ...entries.map(([, n]) => n),
    ]);
  }
}

function relationshipOf(verdict: string): CrmRelationship | null {
  if (verdict === 'customer') return CrmRelationship.Customer;
  if (verdict === 'prospect') return CrmRelationship.Prospect;
  return null;
}

/** Problems with the connection itself: every further mail would fail the same way. */
function isMailboxProblem(err: unknown): err is MicrosoftNotConnectedError | MicrosoftReauthRequiredError | MicrosoftAppConfigError {
  return (
    err instanceof MicrosoftNotConnectedError || err instanceof MicrosoftReauthRequiredError || err instanceof MicrosoftAppConfigError
  );
}

/** Texts shown in the profile; technical details stay in the log. */
function userMessage(err: unknown): string {
  if (isMailboxProblem(err)) {
    const response = err.getResponse() as { message?: string };
    return response.message ?? err.message;
  }
  if (err instanceof LlmError) return err.message;
  if (err instanceof GraphError) return `Microsoft 365: ${err.message}`;
  return 'Unerwarteter Fehler beim Import.';
}
