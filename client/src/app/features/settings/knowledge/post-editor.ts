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
import { KnowledgeSource, MAX_TEXT_CHARS } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { Markdown } from '../../../shared/markdown';
import { errorMessage, formatNumber } from './knowledge-format';

/** Writes a blog post (date, title, Markdown) or edits one; for an existing post the full content is loaded first. */
@Component({
  selector: 'app-post-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon, Markdown],
  template: `
    <form class="editor" [formGroup]="form" (ngSubmit)="save()" (keydown.escape)="cancelled.emit()">
      <div class="editor__head">
        <span class="editor__title">{{ source() ? 'Beitrag bearbeiten' : 'Neuer Beitrag' }}</span>
        <button type="button" class="icon-btn" aria-label="Schließen" (click)="cancelled.emit()">
          <app-icon name="close" [size]="18" />
        </button>
      </div>

      @if (loading()) {
        <div class="state" aria-live="polite">
          <span class="loader" aria-hidden="true"></span>
          <p>Beitrag wird geladen …</p>
        </div>
      } @else {
        <div class="editor__row">
          <label class="field">
            <span class="field__label">Titel</span>
            <input class="input js-title" formControlName="title" maxlength="300" autocomplete="off" placeholder="z. B. HUB.KI 2.0 ist erschienen" />
          </label>
          <label class="field">
            <span class="field__label">Datum</span>
            <input class="input" type="date" formControlName="publishedAt" />
          </label>
        </div>

        <div class="field">
          <div class="content__head">
            <span class="field__label">Text</span>
            <div class="modes" role="group" aria-label="Ansicht">
              <button type="button" class="mode" [class.is-on]="!previewing()" [attr.aria-pressed]="!previewing()" (click)="previewing.set(false)">
                Schreiben
              </button>
              <button type="button" class="mode" [class.is-on]="previewing()" [attr.aria-pressed]="previewing()" (click)="previewing.set(true)">
                Vorschau
              </button>
            </div>
          </div>

          @if (previewing()) {
            @if (content().trim()) {
              <app-markdown class="preview" [text]="content()" />
            } @else {
              <div class="preview is-empty">Noch kein Text.</div>
            }
          } @else {
            <textarea
              class="textarea editor__content"
              formControlName="content"
              aria-label="Text in Markdown"
              [attr.maxlength]="maxChars"
              placeholder="Was ist neu bei der Firma oder ihren Produkten?"
            ></textarea>
          }
          <div class="content__foot">
            <span class="field__hint">Markdown: **fett**, *kursiv*, ##&nbsp;Überschrift, -&nbsp;Liste, [Link](https://…)</span>
            <span class="field__hint editor__count" [class.is-over]="length() > maxChars">
              {{ formatNumber(length()) }} / {{ formatNumber(maxChars) }} Zeichen
            </span>
          </div>
        </div>

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
            {{ source() ? 'Speichern' : 'Beitrag anlegen' }}
          </button>
        </div>
      }
    </form>
  `,
  styleUrls: ['./text-editor.scss', './post-editor.scss'],
})
export class PostEditor {
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
  readonly previewing = signal(false);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(300)] }),
    publishedAt: new FormControl(today(), { nonNullable: true, validators: [Validators.required] }),
    content: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(MAX_TEXT_CHARS)],
    }),
  });

  readonly content = toSignal(this.form.controls.content.valueChanges, { initialValue: '' });
  readonly length = computed(() => this.content().length);

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
          this.form.reset({ title: full.title, publishedAt: full.publishedAt ?? today(), content: full.content ?? '' });
          this.loading.set(false);
          afterNextRender(() => this.focus(), { injector: this.injector });
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(errorMessage(err, 'Der Beitrag konnte nicht geladen werden.'));
        },
      });
    });
  }

  save(): void {
    if (this.form.invalid || this.busy()) return;
    const { title, publishedAt, content } = this.form.getRawValue();
    const body = { title: title.trim(), publishedAt, content };
    const existing = this.source();
    const request$: Observable<KnowledgeSource> = existing
      ? this.api.updateSource(existing.id, body)
      : this.api.createPost(this.companyId(), body);

    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (source) => {
        this.busy.set(false);
        this.saved.emit(source);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Der Beitrag konnte nicht gespeichert werden.'));
      },
    });
  }

  private focus(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.js-title')?.focus();
  }
}

/** Local date as YYYY-MM-DD, the value format of <input type="date"> */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
