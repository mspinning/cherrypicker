import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../../../shared/icon';

@Component({
  selector: 'app-action-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '[class.compact]': 'compact()' },
  template: `
    @if (editing()) {
      <div class="edit-actions">
        <button type="button" class="pill pill--ghost" (click)="cancel.emit()">Abbrechen</button>
        <button type="button" class="pill pill--primary" (click)="save.emit()">
          @if (!compact()) {
            <app-icon name="check" [size]="20" [strokeWidth]="2.2" />
          }
          {{ compact() ? 'Speichern & senden' : 'Speichern & freigeben' }}
        </button>
      </div>
    } @else {
      <div class="actions">
        <div class="action">
          <button type="button" class="round round--reject" aria-label="Verwerfen" aria-keyshortcuts="ArrowLeft" (click)="reject.emit()">
            <app-icon name="close" [size]="compact() ? 26 : 28" [strokeWidth]="2" />
          </button>
          <span class="action__label" aria-hidden="true">Verwerfen</span>
        </div>
        <div class="action action--minor">
          <button type="button" class="round round--edit" aria-label="Bearbeiten" (click)="edit.emit()">
            <app-icon name="edit" [size]="compact() ? 19 : 20" />
          </button>
          <span class="action__label" aria-hidden="true">Bearbeiten</span>
        </div>
        <div class="action">
          <button type="button" class="round round--approve" aria-label="Freigeben" aria-keyshortcuts="ArrowRight" (click)="approve.emit()">
            <app-icon name="check" [size]="compact() ? 28 : 30" [strokeWidth]="2.2" />
          </button>
          <span class="action__label" aria-hidden="true">Freigeben</span>
        </div>
      </div>
    }
  `,
  styleUrl: './action-bar.scss',
})
export class ActionBar {
  readonly editing = input(false);
  readonly compact = input(false);

  readonly approve = output<void>();
  readonly reject = output<void>();
  readonly edit = output<void>();
  readonly cancel = output<void>();
  readonly save = output<void>();
}
