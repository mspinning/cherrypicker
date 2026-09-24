import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TodayStore } from '../today.store';

/** Summary of today's decisions, shown once the stack is empty. */
@Component({
  selector: 'app-decision-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
  template: `
    <ul class="list" aria-label="Heute entschieden">
      @for (q of store.queue(); track q.id) {
        <li class="row">
          <span class="dot" [attr.data-status]="q.status"></span>
          <span class="row__text">
            <span class="row__name">{{ q.name }}</span>
            <span class="row__meta">{{ q.kindLabel }} · {{ q.company }}</span>
          </span>
          <span class="row__status">{{ q.statusLabel }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 13px 16px;
      border-radius: 16px;
      background-color: var(--row-muted);
    }

    .dot {
      width: 10px;
      height: 10px;
      flex-shrink: 0;
      border-radius: 99px;
      background-color: var(--waiting);

      &[data-status='approved'],
      &[data-status='edited'] {
        background-color: var(--lime);
      }

      &[data-status='rejected'] {
        background-color: var(--coral);
      }
    }

    .row__text {
      flex-grow: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .row__name {
      font-size: 15px;
      font-weight: 500;
    }

    .row__meta {
      font-size: 13px;
      color: var(--ink-muted);
    }

    .row__status {
      font-size: 12px;
      color: var(--ink-soft);
    }

    :host(.compact) {
      .list {
        gap: 8px;
      }

      .row {
        gap: 12px;
        padding: 11px 14px;
        border-radius: 14px;
        background-color: var(--surface-raised);
      }

      .dot {
        width: 9px;
        height: 9px;
      }

      .row__text {
        gap: 2px;
      }

      .row__name {
        font-size: 14px;
      }

      .row__meta {
        font-size: 12px;
      }
    }
  `,
})
export class DecisionList {
  protected readonly store = inject(TodayStore);
  readonly compact = input(false);
}
