import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MailImportApi } from '../../core/mail-import/mail-import-api.service';
import { MailImportJob, MailImportMode, MailImportOverview, isActive } from '../../core/mail-import/mail-import.models';
import { Icon } from '../../shared/icon';
import { errorMessage, formatDateTime, formatNumber, plural } from '../../shared/format';
import { ImportResults } from './import-results';

const POLL_MS = 2_500;
const TEST_SIZES = [50, 100, 250, 500, 1000];
/** 0 = the whole mailbox */
const PERIODS = [6, 12, 24, 36, 0];

/** Profile panel: the initial import of customers from the user's mailbox, with a test mode. */
@Component({
  selector: 'app-mail-import-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, ImportResults],
  templateUrl: './mail-import-panel.html',
  styleUrl: './mail-import-panel.scss',
})
export class MailImportPanel {
  private readonly api = inject(MailImportApi);

  readonly overview = signal<MailImportOverview | null>(null);
  readonly loadFailed = signal(false);
  readonly mode = signal<MailImportMode>('test');
  readonly testSize = signal(100);
  readonly months = signal(12);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly showResults = signal(false);

  readonly active = computed(() => this.overview()?.jobs.find(isActive) ?? null);
  /** Newest finished import, its result stays visible */
  readonly last = computed(() => this.overview()?.jobs.find((job) => !isActive(job)) ?? null);
  readonly testSizes = computed(() => {
    const max = this.overview()?.testLimits.max ?? 1000;
    return TEST_SIZES.filter((n) => n <= max);
  });
  /** Share of counterparts the LLM has decided so far */
  readonly progress = computed(() => {
    const job = this.active();
    if (!job || job.status !== 'analyzing') return null;
    const todo = job.groupsTotal - job.groupsPrefiltered;
    return todo > 0 ? Math.round((job.groupsAnalyzed / todo) * 100) : 100;
  });

  protected readonly periods = PERIODS;
  protected readonly plural = plural;
  protected readonly number = formatNumber;
  protected readonly dateTime = formatDateTime;

  constructor() {
    this.load();
    const timer = setInterval(() => {
      if (!document.hidden && this.active()) this.refresh();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load(): void {
    this.loadFailed.set(false);
    this.api.overview().subscribe({
      next: (overview) => this.overview.set(overview),
      error: () => this.loadFailed.set(true),
    });
  }

  start(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const test = this.mode() === 'test';
    this.api
      .start({ mode: this.mode(), ...(test ? { maxMessages: this.testSize() } : this.months() ? { months: this.months() } : {}) })
      .subscribe({
        next: (job) => {
          this.busy.set(false);
          this.showResults.set(false);
          this.overview.update((o) => o && { ...o, jobs: [job, ...o.jobs] });
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.error.set(errorMessage(err, 'Der Import konnte nicht gestartet werden.'));
          this.refresh();
        },
      });
  }

  cancel(job: MailImportJob): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.cancel(job.id).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.replace(updated);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Der Import konnte nicht abgebrochen werden.'));
      },
    });
  }

  phase(job: MailImportJob): string {
    switch (job.status) {
      case 'queued':
        return 'Wartet auf den Start …';
      case 'scanning':
        return `Mails werden gelesen · ${formatNumber(job.messagesScanned)}${job.maxMessages ? ` von ${formatNumber(job.maxMessages)}` : ''}`;
      default:
        return `Gegenseiten werden eingeordnet · ${formatNumber(job.groupsAnalyzed)} von ${formatNumber(job.groupsTotal - job.groupsPrefiltered)}`;
    }
  }

  title(job: MailImportJob): string {
    return job.mode === 'test' ? `Testlauf · ${formatNumber(job.maxMessages ?? 0)} Mails` : 'Vollständiger Import';
  }

  skipped(job: MailImportJob): number {
    return job.groupsPrefiltered + job.groupsAnalyzed - job.groupsImported - job.groupsFailed;
  }

  periodLabel(months: number): string {
    return months ? `Letzte ${months} Monate` : 'Gesamtes Postfach';
  }

  private refresh(): void {
    this.api.overview().subscribe({ next: (overview) => this.overview.set(overview), error: () => {} });
  }

  private replace(job: MailImportJob): void {
    this.overview.update((o) => o && { ...o, jobs: o.jobs.map((j) => (j.id === job.id ? job : j)) });
  }
}
