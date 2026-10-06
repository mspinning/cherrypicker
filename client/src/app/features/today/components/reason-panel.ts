import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { Suggestion } from '../suggestion.model';
import { HintForm } from './hint-form';

/** "Warum dieser Vorschlag": summary, weighted evidence and best time; for an open task also the line to the AI. */
@Component({
  selector: 'app-reason-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HintForm, Icon],
  host: { '[class.compact]': 'compact()' },
  template: `
    @let s = suggestion();
    <div class="scroll">
      <div class="intro">
        <div class="eyebrow eyebrow--accent">Warum dieser Vorschlag</div>
        <p class="summary">{{ s.summary }}</p>
      </div>

      <ul class="evidence">
        @for (e of s.evidence; track $index) {
          <li class="evidence__item">
            <div class="eyebrow evidence__meta">
              <span>{{ e.source }}</span>
              @if (!compact()) {
                <span>Gewicht {{ e.weight }}</span>
              }
            </div>
            <div class="evidence__text">{{ e.text }}</div>
            <div
              class="meter"
              role="meter"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="e.weight"
              [attr.aria-label]="'Gewicht ' + e.source"
            >
              <div class="meter__fill" [style.width.%]="e.weight"></div>
            </div>
          </li>
        }
      </ul>

      <div class="footer">
        <div class="best-time">
          <app-icon name="clock" [size]="compact() ? 16 : 18" class="best-time__icon" />
          <span class="best-time__label">Bester Zeitpunkt</span>
          <span class="best-time__value">{{ s.bestTime }}</span>
        </div>
        @if (!compact()) {
          <p class="on-approve">{{ s.onApprove }}</p>
        }
      </div>
    </div>

    @if (revisable()) {
      <app-hint-form class="hint" [taskId]="s.id" [compact]="compact()" />
    }
  `,
  styleUrl: './reason-panel.scss',
})
export class ReasonPanel {
  readonly suggestion = input.required<Suggestion>();
  readonly compact = input(false);
  /** The task is still open: the user may tell the AI what to change */
  readonly revisable = input(false);
}
