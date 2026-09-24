import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, viewChild } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { Suggestion } from '../suggestion.model';
import { ReasonPanel } from './reason-panel';

@Component({
  selector: 'app-suggestion-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ReasonPanel],
  host: { '[class.compact]': 'compact()' },
  templateUrl: './suggestion-card.html',
  styleUrl: './suggestion-card.scss',
})
export class SuggestionCard {
  readonly suggestion = input.required<Suggestion>();
  readonly draft = input.required<string>();
  readonly editing = input(false);
  /** Mobile: the card shows the reasoning instead of the draft */
  readonly showReason = input(false);
  /** Mobile layout: smaller type, reasoning lives inside the card */
  readonly compact = input(false);
  readonly approveStamp = input(0);
  readonly rejectStamp = input(0);

  readonly draftChange = output<string>();
  readonly toggleReason = output<void>();

  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  readonly confidenceBars = computed(() => {
    const filled = Math.round(this.suggestion().confidence / 10);
    return Array.from({ length: 10 }, (_, i) => i < filled);
  });

  constructor() {
    effect(() => this.editor()?.nativeElement.focus({ preventScroll: true }));
  }

  onInput(event: Event): void {
    this.draftChange.emit((event.target as HTMLTextAreaElement).value);
  }
}
