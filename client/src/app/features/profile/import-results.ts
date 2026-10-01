import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MailImportApi } from '../../core/mail-import/mail-import-api.service';
import { MailImportGroup, MailImportGroupPage, verdictLabel } from '../../core/mail-import/mail-import.models';
import { Icon } from '../../shared/icon';
import { formatNumber, plural } from '../../shared/format';

type Filter = 'imported' | 'skipped' | 'failed';

const PAGE_SIZE = 30;
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'imported', label: 'Übernommen' },
  { value: 'skipped', label: 'Aussortiert' },
  { value: 'failed', label: 'Fehler' },
];
const DECIDERS: Record<string, string> = {
  llm: 'KI',
  rule: 'Regel',
  memory: 'Schon bekannt',
  user: 'Von Hand ignoriert',
};

/** Every counterpart of an import with its decision and the reason, so a test run can be checked. */
@Component({
  selector: 'app-import-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <div class="filters" role="group" aria-label="Entscheidungen filtern">
      @for (f of filters; track f.value) {
        <button type="button" class="filter" [class.is-on]="filter() === f.value" [attr.aria-pressed]="filter() === f.value" (click)="filter.set(f.value)">
          {{ f.label }}
          <span class="filter__count">{{ count(f.value) }}</span>
        </button>
      }
    </div>

    @if (items().length) {
      <ul class="rows">
        @for (g of items(); track g.id) {
          <li class="row">
            <div class="row__head">
              <span class="row__name">{{ g.company?.name ?? g.companyName ?? g.label }}</span>
              <span class="verdict" [attr.data-verdict]="g.verdict">{{ verdict(g.verdict) }}</span>
            </div>
            <div class="row__meta">{{ meta(g) }}</div>
            @if (g.reason || g.error) {
              <p class="row__reason">{{ g.reason ?? g.error }}</p>
            }
            @if (g.company) {
              <a class="row__link" routerLink="/customers" [queryParams]="{ company: g.company.id }">
                Firma öffnen
                <app-icon name="arrow" [size]="14" />
              </a>
            }
          </li>
        }
      </ul>
      @if (items().length < (page()?.total ?? 0)) {
        <button type="button" class="more" [disabled]="loading()" (click)="loadMore()">Weitere laden</button>
      }
    } @else if (failed()) {
      <p class="empty">Die Entscheidungen konnten nicht geladen werden.</p>
    } @else if (!loading()) {
      <p class="empty">Keine Einträge.</p>
    }
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .filter {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 14px;
      border: 1px solid var(--border-strong);
      border-radius: 99px;
      background: none;
      color: var(--ink-muted);
      font-size: 13.5px;

      &.is-on {
        border-color: var(--lime-deep);
        color: var(--ink);
      }
    }

    .filter__count {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--ink-soft);
    }

    .rows {
      @include reset-list;
      display: flex;
      flex-direction: column;
    }

    .row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 0;
      border-bottom: 1px solid var(--surface-border);

      &:last-child {
        border-bottom: 0;
      }
    }

    .row__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .row__name {
      font-size: 14.5px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .verdict {
      flex-shrink: 0;
      padding: 3px 9px;
      border-radius: 99px;
      border: 1px solid var(--border-strong);
      @include eyebrow(9.5px, 0.08em);
      color: var(--ink-soft);

      &[data-verdict='customer'],
      &[data-verdict='prospect'] {
        border-color: rgba(200, 241, 105, 0.45);
        color: var(--lime);
      }
    }

    .row__meta {
      font-size: 12.5px;
      color: var(--ink-muted);
    }

    .row__reason {
      margin: 2px 0 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--ink-body);
    }

    .row__link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      font-size: 13px;
      text-decoration: none;
    }

    .more {
      align-self: center;
      height: 36px;
      padding: 0 16px;
      border: 1px solid var(--border-strong);
      border-radius: 99px;
      background: none;
      font-size: 13.5px;
    }

    .empty {
      margin: 0;
      font-size: 13.5px;
      color: var(--ink-muted);
    }
  `,
})
export class ImportResults {
  private readonly api = inject(MailImportApi);

  readonly jobId = input.required<string>();
  readonly filter = signal<Filter>('imported');
  readonly page = signal<MailImportGroupPage | null>(null);
  readonly items = signal<MailImportGroup[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);

  protected readonly filters = FILTERS;
  protected readonly verdict = verdictLabel;
  private readonly counts = computed(() => this.page()?.counts ?? null);
  private request?: Subscription;

  constructor() {
    effect(() => {
      this.jobId();
      this.filter();
      untracked(() => this.fetch(0));
    });
  }

  count(filter: Filter): string {
    return formatNumber(this.counts()?.[filter] ?? 0);
  }

  meta(g: MailImportGroup): string {
    const parts = [g.label, plural(g.messageCount, 'Mail', 'Mails')];
    if (g.decidedBy) {
      const confidence = g.decidedBy === 'llm' && g.confidence !== null ? ` ${Math.round(g.confidence * 100)} %` : '';
      parts.push(`${DECIDERS[g.decidedBy] ?? g.decidedBy}${confidence}`);
    }
    return parts.join(' · ');
  }

  loadMore(): void {
    this.fetch(this.items().length);
  }

  private fetch(offset: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    if (!offset) this.items.set([]);
    this.request = this.api.groups(this.jobId(), { status: this.filter(), offset, limit: PAGE_SIZE }).subscribe({
      next: (page) => {
        this.page.set(page);
        this.items.update((list) => (offset ? [...list, ...page.items] : page.items));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }
}
