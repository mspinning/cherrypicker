import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TodayStore } from '../today.store';

/** Desktop sidebar: today's suggestions in order with their status. */
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
        <li class="row" [class.is-current]="q.status === 'current'" [class.is-waiting]="q.status === 'waiting'" [attr.aria-current]="q.status === 'current' ? 'step' : null">
          <span class="row__pos">{{ q.position }}</span>
          <span class="row__text">
            <span class="row__name">{{ q.name }}</span>
            <span class="row__meta">{{ q.kindLabel }} · {{ q.company }}</span>
          </span>
          <span class="row__status">
            <span class="dot" [attr.data-status]="q.status"></span>
            {{ q.statusLabel }}
          </span>
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
}
