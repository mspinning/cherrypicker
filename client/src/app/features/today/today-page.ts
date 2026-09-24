import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Viewport } from '../../core/viewport';
import { ActionBar } from './components/action-bar';
import { DecisionList } from './components/decision-list';
import { DonePanel } from './components/done-panel';
import { QueueList } from './components/queue-list';
import { ReasonPanel } from './components/reason-panel';
import { SuggestionStack } from './components/suggestion-stack';
import { UndoToast } from './components/undo-toast';
import { TodayStore } from './today.store';

@Component({
  selector: 'app-today-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionBar, DecisionList, DonePanel, QueueList, ReasonPanel, SuggestionStack, UndoToast],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './today-page.html',
  styleUrl: './today-page.scss',
})
export class TodayPage {
  protected readonly store = inject(TodayStore);
  protected readonly isDesktop = inject(Viewport).isDesktop;

  /** Soft background glow that tints lime / coral while swiping. */
  readonly glowColor = computed(() => {
    if (this.store.approveStrength() > 0) return 'var(--lime)';
    if (this.store.rejectStrength() > 0) return 'var(--coral)';
    return 'var(--ink)';
  });

  readonly glowOpacity = computed(() => {
    const strength = Math.max(this.store.approveStrength(), this.store.rejectStrength());
    return strength > 0 ? 0.08 + 0.22 * strength : 0.05;
  });

  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (this.store.editing()) {
      if (event.key === 'Escape') this.store.cancelEdit();
      return;
    }
    if (target.closest('input, textarea, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.store.done()) return;
    if (event.key === 'ArrowRight') this.store.approve();
    else if (event.key === 'ArrowLeft') this.store.reject();
  }
}
