import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from '../../shared/icon';
import { formatNumber } from '../../shared/format';

/** Up to this many pages every number is shown, beyond that the edges and the neighbours of the current one */
const ALL_UP_TO = 7;

/** "‹ 1 2 3 … 10 ›" plus "11–20 von 100". Pages are 0-based inside, 1-based on screen. */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <nav class="pager" aria-label="Seiten">
      <span class="range">{{ range() }}</span>
      <div class="pages">
        <button type="button" class="btn" [disabled]="page() === 0" aria-label="Vorherige Seite" (click)="pageChange.emit(page() - 1)">
          <app-icon name="back" [size]="16" />
        </button>
        @for (item of items(); track $index) {
          @if (item === null) {
            <span class="gap" aria-hidden="true">…</span>
          } @else {
            <button
              type="button"
              class="btn"
              [class.is-on]="item === page()"
              [attr.aria-current]="item === page() ? 'page' : null"
              [attr.aria-label]="'Seite ' + (item + 1)"
              (click)="item !== page() && pageChange.emit(item)"
            >
              {{ item + 1 }}
            </button>
          }
        }
        <button
          type="button"
          class="btn is-next"
          [disabled]="page() >= pages() - 1"
          aria-label="Nächste Seite"
          (click)="pageChange.emit(page() + 1)"
        >
          <app-icon name="back" [size]="16" />
        </button>
      </div>
    </nav>
  `,
  styles: `
    .pager {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding-top: 12px;
      border-top: 1px solid var(--surface-border);
    }

    .range {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--ink-muted);
    }

    .pages {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 4px;
    }

    .btn {
      min-width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: none;
      color: var(--ink-soft);
      font-family: var(--font-mono);
      font-size: 12.5px;
      transition:
        background-color 0.15s,
        color 0.15s;

      &:hover:not(:disabled):not(.is-on) {
        background-color: var(--row-muted);
        color: var(--ink);
      }

      &.is-on {
        border-color: var(--lime-deep);
        background-color: var(--track);
        color: var(--ink);
        cursor: default;
      }

      &:disabled {
        opacity: 0.35;
        cursor: default;
      }

      &:focus-visible {
        outline: 2px solid var(--lime);
        outline-offset: 2px;
      }
    }

    .is-next app-icon {
      transform: rotate(180deg);
    }

    .gap {
      min-width: 20px;
      text-align: center;
      color: var(--ink-muted);
    }
  `,
})
export class Pager {
  /** 0-based */
  readonly page = input.required<number>();
  readonly total = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly pageChange = output<number>();

  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly range = computed(() => {
    const from = this.page() * this.pageSize() + 1;
    const to = Math.min(this.total(), from + this.pageSize() - 1);
    return `${formatNumber(from)}–${formatNumber(to)} von ${formatNumber(this.total())}`;
  });
  /** Page numbers, null for "…" */
  readonly items = computed(() => pageWindow(this.page(), this.pages()));
}

/** 10 pages, current 5 (0-based) → 0 … 4 5 6 … 9; near an edge the first or last five */
export function pageWindow(current: number, count: number): (number | null)[] {
  if (count <= ALL_UP_TO) return Array.from({ length: count }, (_, i) => i);
  const shown = new Set([0, count - 1, current - 1, current, current + 1]);
  if (current <= 3) for (let i = 0; i < 5; i++) shown.add(i);
  if (current >= count - 4) for (let i = count - 5; i < count; i++) shown.add(i);
  const sorted = [...shown].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);

  const items: (number | null)[] = [];
  for (const p of sorted) {
    const prev = items[items.length - 1];
    if (typeof prev === 'number' && p - prev === 2) items.push(prev + 1);
    else if (typeof prev === 'number' && p - prev > 2) items.push(null);
    items.push(p);
  }
  return items;
}
