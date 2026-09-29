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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import {
  CATEGORIES,
  KnowledgeSource,
  SourceCategory,
  categoryLabel,
  isPending,
} from '../../../core/knowledge/knowledge.models';
import { Icon, IconName } from '../../../shared/icon';
import { KnowledgeStore } from './knowledge.store';
import { errorMessage, formatBytes, formatDate, plural, saveBlob, statusLabel } from './knowledge-format';

const TYPE_ICONS: Record<KnowledgeSource['type'], IconName> = { text: 'text', url: 'link', document: 'file' };

/**
 * One source in a list: status, metadata and its actions. Talks to the API
 * itself and reports the result, so the lists only keep their items in sync.
 */
@Component({
  selector: 'app-source-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './source-item.html',
  styleUrl: './source-item.scss',
  host: {
    '[class.is-failed]': "source().status === 'failed'",
    '[class.is-editing]': 'editing()',
    '[class.is-confirming]': 'confirming()',
  },
})
export class SourceItem {
  private readonly api = inject(KnowledgeApi);
  private readonly store = inject(KnowledgeStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly source = input.required<KnowledgeSource>();
  /** Text sources open the full editor of the list instead of the inline title/category form */
  readonly contentEditable = input(false);

  readonly changed = output<KnowledgeSource>();
  readonly removed = output<string>();
  readonly editContent = output<KnowledgeSource>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirming = signal(false);
  readonly editing = signal(false);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(300)] }),
    category: new FormControl<SourceCategory>('other', { nonNullable: true }),
  });

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabel = categoryLabel;
  protected readonly formatDate = formatDate;

  readonly icon = computed(() => TYPE_ICONS[this.source().type]);
  readonly pending = computed(() => isPending(this.source()));
  readonly vectorsPaused = computed(() => !!this.store.embedding()?.lastError);
  readonly status = computed(() => statusLabel(this.source(), this.vectorsPaused()));
  readonly meta = computed(() => {
    const s = this.source();
    const parts: string[] = [];
    if (s.type === 'document') {
      if (s.fileName && s.fileName !== s.title) parts.push(s.fileName);
      if (s.fileSize !== null) parts.push(formatBytes(s.fileSize));
      if (s.pageCount) parts.push(plural(s.pageCount, 'Seite', 'Seiten'));
    }
    if (s.status === 'ready' || s.status === 'embedding') parts.push(plural(s.chunkCount, 'Abschnitt', 'Abschnitte'));
    return parts;
  });
  readonly dateLabel = computed(() => {
    const s = this.source();
    if (s.type === 'url') return s.processedAt ? `abgerufen ${formatDate(s.processedAt)}` : `hinzugefügt ${formatDate(s.createdAt)}`;
    return `${s.type === 'document' ? 'hochgeladen' : 'angelegt'} ${formatDate(s.createdAt)}`;
  });
  readonly name = computed(() => `„${this.source().title}“`);

  startEdit(): void {
    if (this.contentEditable()) {
      this.editContent.emit(this.source());
      return;
    }
    const s = this.source();
    this.form.reset({ title: s.title, category: s.category });
    this.error.set(null);
    this.editing.set(true);
    this.focusAfterRender('.edit input');
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.focusAfterRender('.js-edit');
  }

  saveEdit(): void {
    if (this.form.invalid) return;
    const { title, category } = this.form.getRawValue();
    this.run(this.api.updateSource(this.source().id, { title: title.trim(), category }), 'Speichern hat nicht geklappt.', (s) => {
      this.editing.set(false);
      this.changed.emit(s);
    });
  }

  reprocess(): void {
    this.run(this.api.reprocess(this.source().id), 'Konnte nicht neu gestartet werden.', (s) => {
      this.changed.emit(s);
      this.store.refresh();
    });
  }

  download(): void {
    const s = this.source();
    this.run(this.api.download(s.id), 'Download fehlgeschlagen.', (blob) => saveBlob(blob, s.fileName ?? s.title));
  }

  askDelete(): void {
    this.error.set(null);
    this.confirming.set(true);
    this.focusAfterRender('.js-cancel-delete');
  }

  cancelDelete(): void {
    this.confirming.set(false);
    this.focusAfterRender('.js-delete');
  }

  confirmDelete(): void {
    this.run(this.api.removeSource(this.source().id), 'Löschen hat nicht geklappt.', () => {
      this.removed.emit(this.source().id);
      this.store.refresh();
    });
  }

  private run<T>(request$: Observable<T>, failure: string, onSuccess: (value: T) => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (value) => {
        this.busy.set(false);
        onSuccess(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, failure));
      },
    });
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
