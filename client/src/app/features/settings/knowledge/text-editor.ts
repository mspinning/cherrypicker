import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { CATEGORIES, KnowledgeSource, MAX_TEXT_CHARS, SourceCategory } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { errorMessage, formatNumber } from './knowledge-format';

/** Writes a new text or edits one; for an existing text the full content is loaded first. */
@Component({
  selector: 'app-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon],
  template: `
    <form class="editor" [formGroup]="form" (ngSubmit)="save()" (keydown.escape)="cancelled.emit()">
      <div class="editor__head">
        <span class="editor__title">{{ source() ? 'Text bearbeiten' : 'Neuer Text' }}</span>
        <button type="button" class="icon-btn" aria-label="Schließen" (click)="cancelled.emit()">
          <app-icon name="close" [size]="18" />
        </button>
      </div>

      @if (loading()) {
        <div class="state" aria-live="polite">
          <span class="loader" aria-hidden="true"></span>
          <p>Text wird geladen …</p>
        </div>
      } @else {
        <div class="editor__row">
          <label class="field">
            <span class="field__label">Titel</span>
            <input class="input js-title" formControlName="title" maxlength="300" autocomplete="off" placeholder="z. B. Leistungsportfolio Cloud" />
          </label>
          <label class="field">
            <span class="field__label">Kategorie</span>
            <select class="select" formControlName="category">
              @for (c of categories; track c.value) {
                <option [value]="c.value">{{ c.label }}</option>
              }
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">Inhalt</span>
          <textarea
            class="textarea editor__content"
            formControlName="content"
            [attr.maxlength]="maxChars"
            placeholder="Was bietet die Firma an, für wen, zu welchen Konditionen? Stichpunkte reichen."
          ></textarea>
          <span class="field__hint editor__count" [class.is-over]="length() > maxChars">
            {{ formatNumber(length()) }} / {{ formatNumber(maxChars) }} Zeichen
          </span>
        </label>

        @if (error(); as message) {
          <div class="alert" role="alert">
            <app-icon name="alert" [size]="18" />
            <span>{{ message }}</span>
          </div>
        }

        <div class="editor__actions">
          <button type="button" class="pill" (click)="cancelled.emit()">Abbrechen</button>
          <button type="submit" class="pill pill--primary" [disabled]="busy() || form.invalid">
            @if (busy()) {
              <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
            }
            {{ source() ? 'Speichern' : 'Text anlegen' }}
          </button>
        </div>
      }
    </form>
  `,
  styleUrl: './text-editor.scss',
})
export class TextEditor {
  private readonly api = inject(KnowledgeApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly companyId = input.required<string>();
  /** Set when editing */
  readonly source = input<KnowledgeSource | null>(null);

  readonly saved = output<KnowledgeSource>();
  readonly cancelled = output<void>();

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(300)] }),
    category: new FormControl<SourceCategory>('service', { nonNullable: true }),
    content: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(MAX_TEXT_CHARS)],
    }),
  });

  private readonly content = toSignal(this.form.controls.content.valueChanges, { initialValue: '' });
  readonly length = computed(() => this.content().length);

  protected readonly categories = CATEGORIES;
  protected readonly maxChars = MAX_TEXT_CHARS;
  protected readonly formatNumber = formatNumber;

  constructor() {
    afterNextRender(() => {
      const existing = this.source();
      if (!existing) {
        this.focus();
        return;
      }
      this.loading.set(true);
      this.api.source(existing.id).subscribe({
        next: (full) => {
          this.form.reset({ title: full.title, category: full.category, content: full.content ?? '' });
          this.loading.set(false);
          afterNextRender(() => this.focus(), { injector: this.injector });
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(errorMessage(err, 'Der Text konnte nicht geladen werden.'));
        },
      });
    });
  }

  save(): void {
    if (this.form.invalid || this.busy()) return;
    const { title, category, content } = this.form.getRawValue();
    const body = { title: title.trim(), category, content };
    const existing = this.source();
    const request$: Observable<KnowledgeSource> = existing
      ? this.api.updateSource(existing.id, body)
      : this.api.createText(this.companyId(), body);

    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (source) => {
        this.busy.set(false);
        this.saved.emit(source);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Der Text konnte nicht gespeichert werden.'));
      },
    });
  }

  private focus(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.js-title')?.focus();
  }
}
