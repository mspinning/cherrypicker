import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { QueueItem } from '../suggestion.model';
import { TodayStore } from '../today.store';

/** Desktop sidebar: today's suggestions in order with their status; a decided one opens again on click, to read. */
@Component({
  selector: 'app-queue-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h1 class="title">Heute</h1>
      <div class="count" aria-live="polite">{{ store.openLabel() }}</div>
    </div>

    <ol class="list" aria-label="Vorschläge">
      @for (q of store.queue(); track q.id) {
        <li class="item" [attr.aria-current]="q.status === 'current' ? 'step' : null">
          <button
            type="button"
            class="row"
            [class.is-shown]="q.shown"
            [class.is-waiting]="q.status === 'waiting'"
            [disabled]="q.status === 'waiting'"
            [attr.aria-pressed]="q.decided ? q.shown : null"
            [attr.title]="q.decided ? 'Ansehen' : null"
            (click)="open(q)"
          >
            <span class="row__pos">{{ q.position }}</span>
            <span class="row__text">
              <span class="row__name">{{ q.name }}</span>
              <span class="row__meta">{{ q.kindLabel }} · {{ q.company }}</span>
            </span>
            <span class="row__status">
              <span class="dot" [attr.data-status]="q.status"></span>
              {{ q.statusLabel }}
            </span>
          </button>
        </li>
      }
    </ol>

    <div class="hints">
      <div class="hint"><kbd class="key key--approve">→</kbd>Karte nach rechts ziehen: freigeben</div>
      <div class="hint"><kbd class="key key--reject">←</kbd>Karte nach links ziehen: verwerfen</div>
    </div>
  `,
  styleUrl: './queue-list.scss',
})
export class QueueList {
  protected readonly store = inject(TodayStore);

  /** A decided task opens to read; the current one brings the stack back. */
  protected open(item: QueueItem): void {
    if (item.decided) this.store.view(item.id);
    else this.store.closeView();
  }
}
