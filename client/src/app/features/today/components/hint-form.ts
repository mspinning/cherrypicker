import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { TodayStore } from '../today.store';

/**
 * Below the reasoning of an open task: a line to the AI ("Produkt XY passt
 * besser", "interessiert sich auch für …"). The AI reworks the task with it
 * and notes in the CRM what it says about the customer.
 */
@Component({
  selector: 'app-hint-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '[class.compact]': 'compact()' },
  template: `
    <form class="form" (submit)="send($event)">
      <!-- On a phone the placeholder says it: the reasoning above needs the room -->
      <label class="eyebrow" [class.visually-hidden]="compact()" [attr.for]="fieldId()">Cherrypick etwas mitgeben</label>
      <div class="field" [class.is-busy]="busy()">
        <textarea
          class="input"
          maxlength="1000"
          [rows]="compact() ? 1 : 2"
          enterkeyhint="send"
          [placeholder]="compact() ? 'Hinweis an Cherrypick …' : 'z. B. „Produkt XY passt besser“ oder „Interessiert sich auch für …“'"
          [id]="fieldId()"
          [value]="hint()"
          [disabled]="busy() || !available()"
          (input)="onInput($event)"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        <button type="submit" class="send" [disabled]="!sendable()" aria-label="Vorschlag anpassen lassen" title="Vorschlag anpassen lassen">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span>
          } @else {
            <app-icon name="sparkle" [size]="18" />
          }
        </button>
      </div>
      @if (busy()) {
        <p class="note" role="status">Cherrypick überarbeitet den Vorschlag …</p>
      } @else if (error(); as message) {
        <p class="note note--error" role="alert">{{ message }}</p>
      } @else if (!available()) {
        <p class="note">Erst wieder möglich, wenn du mit dem Bearbeiten fertig bist.</p>
      } @else {
        <p class="note note--idle">Cherrypick passt den Vorschlag an. Was du über den Kunden sagst, steht danach als Notiz im CRM.</p>
      }
    </form>
  `,
  styleUrl: './hint-form.scss',
})
export class HintForm {
  private readonly store = inject(TodayStore);

  readonly taskId = input.required<string>();
  readonly compact = input(false);

  protected readonly fieldId = computed(() => `hint-${this.taskId()}`);
  protected readonly hint = computed(() => this.store.hintOf(this.taskId()));
  protected readonly busy = computed(() => this.store.isRevising(this.taskId()));
  protected readonly error = computed(() => this.store.hintErrorOf(this.taskId()));
  /** Not while the draft is being edited by hand: the AI would write over it */
  protected readonly available = computed(() => this.store.canRevise(this.taskId()));
  protected readonly sendable = computed(() => this.available() && !this.busy() && !!this.hint().trim());

  protected onInput(event: Event): void {
    this.store.updateHint(this.taskId(), (event.target as HTMLTextAreaElement).value);
  }

  /** Enter sends, Shift+Enter breaks the line. */
  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    key.preventDefault();
    this.store.revise(this.taskId());
  }

  protected send(event: Event): void {
    event.preventDefault();
    this.store.revise(this.taskId());
  }
}
