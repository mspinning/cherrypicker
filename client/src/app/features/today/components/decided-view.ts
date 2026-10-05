import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { TodayStore } from '../today.store';
import { SuggestionCard } from './suggestion-card';

/** A decided task opened again from the list: its card to read, with the decision instead of the actions. */
@Component({
  selector: 'app-decided-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, SuggestionCard],
  host: { '[class.compact]': 'compact()' },
  template: `
    @if (store.viewing(); as s) {
      <div class="frame">
        <app-suggestion-card
          class="card"
          [suggestion]="s"
          [draft]="store.viewingDraft()"
          [showReason]="store.showReason()"
          [compact]="compact()"
          (toggleReason)="store.toggleReason()"
        />
      </div>

      <div class="bar">
        @if (store.viewingItem(); as item) {
          <div class="verdict">
            <span class="verdict__status">
              <span class="dot" [attr.data-status]="item.status"></span>
              {{ item.statusLabel }}
            </span>
            <span class="verdict__note">
              <app-icon name="lock" [size]="13" />
              Nur Ansicht
            </span>
          </div>
        }
        <button type="button" class="back" aria-keyshortcuts="Escape" (click)="store.closeView()">
          <app-icon name="back" [size]="18" />
          {{ store.done() ? 'Zur Übersicht' : 'Zur aktuellen Karte' }}
        </button>
      </div>
    }
  `,
  styleUrl: './decided-view.scss',
})
export class DecidedView {
  protected readonly store = inject(TodayStore);
  readonly compact = input(false);
}
