import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { verdictLabel } from '../../core/mail-import/mail-import.models';
import { MailSyncApi } from '../../core/mail-sync/mail-sync-api.service';
import { MailSyncItem, MailSyncOverview, MailSyncState, isHit } from '../../core/mail-sync/mail-sync.models';
import { Icon } from '../../shared/icon';
import { errorMessage, formatDateTime, formatNumber, formatTime, plural } from '../../shared/format';

/** While a check runs the panel follows it closely, otherwise it just keeps up */
const POLL_BUSY_MS = 3_000;
const POLL_IDLE_MS = 20_000;
const VISIBLE = 8;

type Filter = 'hits' | 'all';

/** Profile panel: the background check of the mailbox for new customers and opportunities. */
@Component({
  selector: 'app-mail-sync-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  templateUrl: './mail-sync-panel.html',
  styleUrl: './mail-sync-panel.scss',
})
export class MailSyncPanel {
  private readonly api = inject(MailSyncApi);

  readonly overview = signal<MailSyncOverview | null>(null);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal<Filter>('hits');
  readonly expanded = signal(false);

  readonly state = computed(() => this.overview()?.state ?? null);
  /** The server can check mailboxes at all */
  readonly ready = computed(() => {
    const o = this.overview();
    return !!o && o.available && o.llmConfigured;
  });
  readonly hits = computed(() => (this.overview()?.recent ?? []).filter(isHit));
  readonly items = computed(() => {
    const list = this.filter() === 'hits' ? this.hits() : (this.overview()?.recent ?? []);
    return this.expanded() ? list : list.slice(0, VISIBLE);
  });
  readonly hiddenCount = computed(() => {
    const total = this.filter() === 'hits' ? this.hits().length : (this.overview()?.recent.length ?? 0);
    return total - this.items().length;
  });

  protected readonly number = formatNumber;
  protected readonly dateTime = formatDateTime;
  protected readonly plural = plural;

  private lastPoll = Date.now();

  constructor() {
    this.load();
    const timer = setInterval(() => {
      if (document.hidden || !this.overview()) return;
      const pause = this.state()?.syncing ? POLL_BUSY_MS : POLL_IDLE_MS;
      if (Date.now() - this.lastPoll >= pause) this.refresh();
    }, POLL_BUSY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load(): void {
    this.loadFailed.set(false);
    this.lastPoll = Date.now();
    this.api.overview().subscribe({
      next: (overview) => this.show(overview),
      error: () => this.loadFailed.set(true),
    });
  }

  toggle(): void {
    const state = this.state();
    if (!state || this.busy()) return;
    this.change(this.api.setEnabled(!state.enabled), 'Die Einstellung konnte nicht gespeichert werden.');
  }

  runNow(): void {
    if (this.busy()) return;
    this.change(this.api.run(), 'Die Prüfung konnte nicht gestartet werden.');
  }

  badge(state: MailSyncState): string {
    if (!state.enabled) return 'Pausiert';
    return state.syncing ? 'Prüft gerade' : 'Aktiv';
  }

  status(state: MailSyncState): string {
    if (state.syncing) return 'Dein Postfach wird gerade geprüft …';
    const last = state.lastSyncAt ? `Zuletzt geprüft: ${formatDateTime(state.lastSyncAt)}` : 'Noch nicht geprüft';
    return state.nextSyncAt ? `${last} · wieder um ${formatTime(state.nextSyncAt)} Uhr` : last;
  }

  who(item: MailSyncItem): string {
    if (item.direction === 'out') return item.company ? `Deine Mail an ${item.company.name}` : 'Deine Mail';
    const name = item.fromName || item.fromEmail;
    return item.company ? `${name} · ${item.company.name}` : name;
  }

  label(item: MailSyncItem): string {
    switch (item.outcome) {
      case 'task':
        return 'Aufgabe';
      case 'customer':
        return item.verdict === 'customer' ? 'Neuer Kunde' : 'Neuer Interessent';
      case 'none':
        return 'Kein Schritt nötig';
      case 'failed':
        return 'Fehler';
      default:
        return verdictLabel(item.verdict);
    }
  }

  /** What became of the task that came from the mail */
  taskState(item: MailSyncItem): string {
    switch (item.task?.status) {
      case 'approved':
        return 'freigegeben';
      case 'rejected':
        return 'verworfen';
      default:
        return 'wartet unter „Heute“';
    }
  }

  private change(request: ReturnType<MailSyncApi['run']>, fallback: string): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (state) => {
        this.busy.set(false);
        this.overview.update((o) => o && { ...o, state });
        this.lastPoll = Date.now();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, fallback));
      },
    });
  }

  private refresh(): void {
    this.lastPoll = Date.now();
    this.api.overview().subscribe({ next: (overview) => this.show(overview), error: () => {} });
  }

  private show(overview: MailSyncOverview): void {
    this.overview.set(overview);
    // Nothing found yet: the list of everything that was checked says more than an empty one
    if (!overview.recent.some(isHit) && this.filter() === 'hits' && overview.recent.length) this.filter.set('all');
  }
}
