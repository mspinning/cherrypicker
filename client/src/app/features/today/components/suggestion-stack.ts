import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TodayStore } from '../today.store';
import { SuggestionCard } from './suggestion-card';

/** The current card plus two cards peeking out behind it; handles the swipe gesture. */
@Component({
  selector: 'app-suggestion-stack',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SuggestionCard],
  host: { '[class.compact]': 'compact()' },
  template: `
    @let next = store.upcoming();
    @if (next[1]; as behind) {
      <div class="ghost ghost--back" aria-hidden="true" [style.transform]="ghostTransform(40, 0.9)" [style.transition]="ghostTransition()">
        @if (!compact()) { {{ behind.contact.company }} }
      </div>
    }
    @if (next[0]; as upNext) {
      <div class="ghost ghost--front" aria-hidden="true" [style.transform]="ghostTransform(20, 0.95)" [style.transition]="ghostTransition()">
        @if (!compact()) { {{ upNext.contact.company }} }
      </div>
    }

    <app-suggestion-card
      class="card"
      [class.is-dragging]="store.dragging()"
      [suggestion]="store.current()"
      [draft]="store.currentDraft()"
      [editing]="store.editing()"
      [showReason]="store.showReason()"
      [compact]="compact()"
      [approveStamp]="store.approveStrength()"
      [rejectStamp]="store.rejectStrength()"
      [style.transform]="cardTransform()"
      [style.transition]="cardTransition()"
      [style.opacity]="store.leaving() ? 0 : 1"
      (draftChange)="store.updateDraft($event)"
      (toggleReason)="store.toggleReason()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="store.endDrag()"
      (pointercancel)="store.endDrag()"
    />
  `,
  styleUrl: './suggestion-stack.scss',
})
export class SuggestionStack {
  protected readonly store = inject(TodayStore);

  readonly compact = input(false);

  private startX = 0;

  readonly cardTransform = computed(() => {
    const leaving = this.store.leaving();
    const fly = this.store.flyDistance();
    if (leaving === 'approve') return `translate(${fly}px, -60px) rotate(26deg)`;
    if (leaving === 'reject') return `translate(-${fly}px, -60px) rotate(-26deg)`;
    const dx = this.store.dx();
    return `translateX(${dx}px) rotate(${(dx / 22).toFixed(2)}deg)`;
  });

  readonly cardTransition = computed(() => {
    if (this.store.snapping() || this.store.dragging()) return 'none';
    if (this.store.leaving()) return 'transform .44s cubic-bezier(.4,.1,.6,1), opacity .44s ease-in';
    return 'transform .6s cubic-bezier(.2,1.6,.4,1)';
  });

  readonly ghostTransition = computed(() =>
    this.store.dragging() || this.store.snapping() ? 'none' : 'transform .44s cubic-bezier(.2,.8,.2,1)',
  );

  /** Ghost cards move one slot forward as the top card is dragged away. */
  ghostTransform(offset: number, scale: number): string {
    const p = this.store.progress();
    return `translateY(${(offset - 20 * p).toFixed(1)}px) scale(${(scale + 0.05 * p).toFixed(3)})`;
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.store.canDrag() || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, textarea, input, a')) return;
    this.startX = event.clientX;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.store.beginDrag();
  }

  onPointerMove(event: PointerEvent): void {
    this.store.dragTo(event.clientX - this.startX);
  }
}
