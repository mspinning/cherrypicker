import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { Toast } from '../suggestion.model';

/** Confirmation after a decision; bottom-center on desktop, top on mobile. */
@Component({
  selector: 'app-undo-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { role: 'status' },
  template: `
    <span class="dot" [class.is-reject]="toast().verdict === 'reject'"></span>
    <span class="text">{{ toast().text }}</span>
    <button type="button" class="undo" (click)="undo.emit()">
      <app-icon name="undo" [size]="16" class="undo__icon" />
      Rückgängig
    </button>
  `,
  styleUrl: './undo-toast.scss',
})
export class UndoToast {
  readonly toast = input.required<Toast>();
  readonly undo = output<void>();
}
