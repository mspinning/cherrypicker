import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { Viewport } from '../../core/viewport';
import { CallStore } from '../../core/voice/call.store';
import { ActionBar } from './components/action-bar';
import { DecidedView } from './components/decided-view';
import { DecisionList } from './components/decision-list';
import { DonePanel } from './components/done-panel';
import { QueueList } from './components/queue-list';
import { ReasonPanel } from './components/reason-panel';
import { SuggestionStack } from './components/suggestion-stack';
import { UndoToast } from './components/undo-toast';
import { TodayStore } from './today.store';

/** How often the page looks for tasks that the mailbox sync created in the background */
const REFRESH_MS = 30_000;

@Component({
  selector: 'app-today-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionBar, DecidedView, DecisionList, DonePanel, QueueList, ReasonPanel, SuggestionStack, UndoToast],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './today-page.html',
  styleUrl: './today-page.scss',
})
export class TodayPage {
  protected readonly store = inject(TodayStore);
  protected readonly isDesktop = inject(Viewport).isDesktop;

  private readonly call = inject(CallStore);

  constructor() {
    // Also again after every call that created tasks
    effect(() => {
      this.call.tasksCreated();
      untracked(() => this.store.load());
    });

    const timer = setInterval(() => {
      if (!document.hidden) this.store.refresh();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

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
    if (this.call.open()) return;
    // A decided task is open to read: nothing here decides or edits
    if (this.store.viewing()) {
      if (event.key === 'Escape') this.store.closeView();
      return;
    }
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
