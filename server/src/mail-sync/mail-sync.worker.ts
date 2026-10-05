import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import {
  GraphError,
  MicrosoftAppConfigError,
  MicrosoftNotConnectedError,
  MicrosoftReauthRequiredError,
} from '../integrations/microsoft/microsoft.errors';
import { LlmError } from '../llm/llm.service';
import { MailSyncState } from './entities/mail-sync-state.entity';
import { CheckStopped, MailboxCheck } from './mailbox-check.service';

const TICK_MS = 20_000;
const MAX_PARALLEL = 2;
/** However often a mailbox fails, it is tried again at least this often */
const MAX_PAUSE_MS = 60 * 60_000;

interface Claimed {
  userId: string;
  checkedUntil: Date;
  failures: number;
}

/**
 * Checks every connected mailbox for new mails, each on its own schedule.
 * The state table is the schedule (claimed with SKIP LOCKED); a check that
 * a restart interrupted simply runs again, no mail is handled twice.
 */
@Injectable()
export class MailSyncWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailSyncWorker.name);
  private readonly cfg: AppConfig['mailSync'];
  private readonly running = new Set<string>();
  private timer?: NodeJS.Timeout;
  private claiming = false;
  private stopped = false;

  constructor(
    @InjectRepository(MailSyncState) private readonly states: Repository<MailSyncState>,
    private readonly dataSource: DataSource,
    private readonly check: MailboxCheck,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('mailSync', { infer: true });
  }

  /** Not switched off by MAIL_SYNC_INTERVAL_MINUTES=0 */
  get enabled(): boolean {
    return this.cfg.intervalMinutes > 0;
  }

  get llmConfigured(): boolean {
    return this.check.configured;
  }

  get intervalMinutes(): number {
    return this.cfg.intervalMinutes;
  }

  async onApplicationBootstrap(): Promise<void> {
    // No check survives a restart
    await this.states.update({ syncingSince: Not(IsNull()) }, { syncingSince: null });
    if (!this.enabled || !this.llmConfigured) {
      this.logger.log(`Mail sync is off: ${this.enabled ? 'no chat model configured (LLM_MODEL)' : 'MAIL_SYNC_INTERVAL_MINUTES=0'}`);
      return;
    }
    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.kick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  /** Starts the checks that are due, while there is room. */
  kick(): void {
    if (this.claiming || this.stopped || !this.enabled || !this.llmConfigured) return;
    this.claiming = true;
    void this.fill()
      .catch((err: Error) => this.logger.error(`Claiming mailboxes to check failed: ${err.message}`))
      .finally(() => (this.claiming = false));
  }

  /**
   * Every connected mailbox gets a schedule, also those connected before the
   * sync existed. The first check looks back a little, so there is something
   * to see right away.
   */
  async adopt(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO mail_sync_states (user_id, checked_until, next_sync_at)
       SELECT c.user_id, now() - ($1::float8 * interval '1 hour'), now()
       FROM microsoft_connections c
       WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM mail_sync_states s WHERE s.user_id = c.user_id)
       ON CONFLICT (user_id) DO NOTHING`,
      [this.cfg.lookbackHours],
    );
  }

  private async fill(): Promise<void> {
    await this.adopt();
    while (this.running.size < MAX_PARALLEL && !this.stopped) {
      const [claimed]: [Claimed[], number] = await this.dataSource.query(
        `UPDATE mail_sync_states
         SET syncing_since = now(), updated_at = now()
         WHERE user_id = (
           SELECT s.user_id FROM mail_sync_states s
           JOIN microsoft_connections c ON c.user_id = s.user_id AND c.status = 'active'
           WHERE s.enabled AND s.syncing_since IS NULL AND s.next_sync_at <= now() AND NOT (s.user_id = ANY($1::uuid[]))
           ORDER BY s.next_sync_at LIMIT 1 FOR UPDATE OF s SKIP LOCKED
         )
         RETURNING user_id AS "userId", checked_until AS "checkedUntil", failures`,
        [[...this.running]],
      );
      const mailbox = claimed[0];
      if (!mailbox) return;
      this.running.add(mailbox.userId);
      void this.run(mailbox).finally(() => {
        this.running.delete(mailbox.userId);
        this.kick();
      });
    }
  }

  private async run(mailbox: Claimed): Promise<void> {
    const startedAt = new Date();
    let outcome: Partial<MailSyncState>;
    try {
      const result = await this.check.run(mailbox.userId, new Date(mailbox.checkedUntil), startedAt);
      if (result.customers || result.tasks) {
        this.logger.log(`Mail sync ${mailbox.userId}: ${result.checked} new mails, ${result.customers} new customers, ${result.tasks} tasks`);
      }
      // Mails that arrived while the check ran are read by the next one
      outcome = { checkedUntil: startedAt, lastSyncAt: new Date(), lastError: null, failures: 0, nextSyncAt: this.dueAfter(0) };
    } catch (err) {
      if (err instanceof CheckStopped) {
        outcome = {};
      } else {
        if (!(err instanceof LlmError || err instanceof GraphError || isMailboxProblem(err))) {
          this.logger.error(`Mail sync ${mailbox.userId} failed: ${(err as Error).message}`, (err as Error).stack);
        }
        const failures = mailbox.failures + 1;
        outcome = { lastError: userMessage(err).slice(0, 1000), failures, nextSyncAt: this.dueAfter(failures) };
      }
    }
    // Zero rows if the mailbox was disconnected meanwhile
    await this.states
      .update({ userId: mailbox.userId }, { ...outcome, syncingSince: null })
      .catch((err: Error) => this.logger.error(`Saving the mail sync state of ${mailbox.userId} failed: ${err.message}`));
  }

  /** The regular pause, doubled with every failure in a row. */
  private dueAfter(failures: number): Date {
    const pause = this.cfg.intervalMinutes * 60_000 * 2 ** Math.min(failures, 10);
    return new Date(Date.now() + Math.min(pause, Math.max(MAX_PAUSE_MS, this.cfg.intervalMinutes * 60_000)));
  }
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
  return 'Unerwarteter Fehler beim Prüfen der Mails.';
}
