import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subscription } from 'rxjs';
import { Repository } from 'typeorm';
import { MicrosoftAuthService } from '../integrations/microsoft/microsoft-auth.service';
import { MicrosoftConnectionStatus } from '../integrations/microsoft/microsoft-connection.entity';
import { MicrosoftNotConnectedError, MicrosoftReauthRequiredError } from '../integrations/microsoft/microsoft.errors';
import { MicrosoftEvents } from '../integrations/microsoft/microsoft.events';
import { MailSyncItemDto, MailSyncOverviewDto, MailSyncStateDto } from './dto/mail-sync.dto';
import { MailSyncItem } from './entities/mail-sync-item.entity';
import { MailSyncState } from './entities/mail-sync-state.entity';
import { MailSyncWorker } from './mail-sync.worker';

const RECENT = 30;

/** The signed-in user's view of the background sync: its state, the switch and what the last mails led to. */
@Injectable()
export class MailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailSyncService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    @InjectRepository(MailSyncState) private readonly states: Repository<MailSyncState>,
    @InjectRepository(MailSyncItem) private readonly items: Repository<MailSyncItem>,
    private readonly worker: MailSyncWorker,
    private readonly auth: MicrosoftAuthService,
    private readonly events: MicrosoftEvents,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      // A new mailbox is checked right away, not at the next tick
      this.events.connected$.subscribe(() => this.worker.kick()),
      // Reconnecting starts fresh; what was handled stays handled
      this.events.disconnected$.subscribe((userId) => {
        void this.states.delete({ userId }).catch((err: Error) => this.logger.error(`Removing the mail sync state failed: ${err.message}`));
      }),
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  async overview(userId: string): Promise<MailSyncOverviewDto> {
    const connection = await this.auth.connection(userId);
    let state = connection ? await this.states.findOneBy({ userId }) : null;
    if (connection?.status === MicrosoftConnectionStatus.Active && !state) {
      await this.worker.adopt();
      this.worker.kick();
      state = await this.states.findOneBy({ userId });
    }
    const recent = await this.items
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.company', 'c')
      .leftJoinAndSelect('i.task', 't')
      .where('i.userId = :userId', { userId })
      .andWhere("(i.direction = 'in' OR i.customerCreated)")
      .orderBy('i.receivedAt', 'DESC')
      .addOrderBy('i.id', 'ASC')
      .take(RECENT)
      .getMany();
    return {
      available: this.worker.enabled,
      llmConfigured: this.worker.llmConfigured,
      intervalMinutes: this.worker.intervalMinutes,
      state: state && MailSyncStateDto.from(state),
      recent: recent.map((item) => MailSyncItemDto.from(item)),
    };
  }

  /** Switching it back on does not dig up what arrived in between: only what is new from now on counts. */
  async setEnabled(userId: string, enabled: boolean): Promise<MailSyncStateDto> {
    const state = await this.requireState(userId);
    if (state.enabled !== enabled) {
      const now = new Date();
      await this.states.update({ userId }, enabled ? { enabled, checkedUntil: now, nextSyncAt: now, lastError: null, failures: 0 } : { enabled });
      if (enabled) this.worker.kick();
    }
    return MailSyncStateDto.from(await this.states.findOneByOrFail({ userId }));
  }

  /** "Jetzt prüfen": the mailbox is next in line. */
  async runNow(userId: string): Promise<MailSyncStateDto> {
    const state = await this.requireState(userId);
    if (state.enabled) {
      await this.states.update({ userId }, { nextSyncAt: new Date() });
      this.worker.kick();
    }
    return MailSyncStateDto.from(await this.states.findOneByOrFail({ userId }));
  }

  private async requireState(userId: string): Promise<MailSyncState> {
    const connection = await this.auth.connection(userId);
    if (!connection) throw new MicrosoftNotConnectedError();
    if (connection.status === MicrosoftConnectionStatus.ReauthRequired) throw new MicrosoftReauthRequiredError();
    await this.worker.adopt();
    return this.states.findOneByOrFail({ userId });
  }
}
