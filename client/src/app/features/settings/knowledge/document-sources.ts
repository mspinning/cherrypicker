import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { CATEGORIES, SourceCategory } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { KnowledgeStore } from './knowledge.store';
import { formatBytes, formatNumber, plural } from './knowledge-format';
import { droppedFiles } from './dropped-files';
import { createSourceList } from './source-list';
import { SourceItem } from './source-item';
import { UploadQueue, UploadState } from './upload-queue';

const UPLOAD_LABELS: Record<UploadState, string> = {
  waiting: 'Wartet',
  uploading: 'Lädt hoch',
  done: 'Hochgeladen',
  duplicate: 'Schon vorhanden',
  error: 'Fehler',
};

/** Past offers, presentations, service descriptions – as many as there are. */
@Component({
  selector: 'app-document-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon, SourceItem],
  templateUrl: './document-sources.html',
  styleUrl: './document-sources.scss',
})
export class DocumentSources {
  private readonly store = inject(KnowledgeStore);
  private readonly queue = inject(UploadQueue);

  readonly companyId = input.required<string>();
  /** Changes when the list has to reload (e.g. after retrying all failed sources) */
  readonly reloadKey = input(0);
  readonly list = createSourceList('document', this.companyId, this.reloadKey);

  readonly dragOver = signal(false);
  /** Files of a folder that were left out (hidden or unsupported type) */
  readonly skipped = signal(0);
  readonly uploadCategory = new FormControl<SourceCategory>('offer', { nonNullable: true });
  readonly search = new FormControl('', { nonNullable: true });
  readonly categoryFilter = new FormControl<SourceCategory | ''>('', { nonNullable: true });
  readonly stateFilter = new FormControl<'' | 'pending' | 'failed' | 'ready'>('', { nonNullable: true });

  readonly uploads = computed(() => this.queue.items().filter((i) => i.companyId === this.companyId()));
  readonly uploadStats = computed(() => {
    const items = this.uploads();
    const finished = items.filter((i) => i.state === 'done' || i.state === 'duplicate' || i.state === 'error');
    // Bytes, not files: one big PDF should not look finished after the small ones
    const total = items.reduce((sum, i) => sum + i.file.size, 0) || 1;
    const sent = items.reduce((sum, i) => sum + i.file.size * (i.state === 'uploading' ? i.progress : i.state === 'waiting' ? 0 : 1), 0);
    return {
      total: items.length,
      finished: finished.length,
      done: items.filter((i) => i.state === 'done').length,
      duplicates: items.filter((i) => i.state === 'duplicate').length,
      errors: items.filter((i) => i.state === 'error').length,
      busy: finished.length < items.length,
      progress: sent / total,
    };
  });
  readonly accept = computed(() => this.store.limits().extensions.join(','));
  readonly maxSize = computed(() => formatBytes(this.store.limits().maxUploadBytes));
  readonly filtered = computed(() => {
    const f = this.list.filters();
    return !!(f.q || f.category || f.state);
  });

  protected readonly categories = CATEGORIES;
  protected readonly uploadLabels = UPLOAD_LABELS;
  protected readonly formatBytes = formatBytes;
  protected readonly formatNumber = formatNumber;
  protected readonly plural = plural;

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => this.list.filters.update((f) => ({ ...f, q: q.trim() })));
    this.categoryFilter.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((category) => this.list.filters.update((f) => ({ ...f, category })));
    this.stateFilter.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((state) => this.list.filters.update((f) => ({ ...f, state })));

    // New uploads of this company show up in the list (batched while many arrive)
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen: number | undefined;
    effect(() => {
      const count = this.queue.arrivals()[this.companyId()] ?? 0;
      untracked(() => {
        if (seen !== undefined && count !== seen) {
          clearTimeout(timer);
          timer = setTimeout(() => this.list.refresh(), 700);
        }
        seen = count;
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  picked(event: Event, fromFolder = false): void {
    const input = event.target as HTMLInputElement;
    this.enqueue([...(input.files ?? [])], fromFolder);
    // Same files again should trigger another change event
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (!zone.contains(event.relatedTarget as Node | null)) this.dragOver.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOver.set(false);
    if (!event.dataTransfer) return;
    const { files, fromFolder } = await droppedFiles(event.dataTransfer);
    this.enqueue(files, fromFolder);
  }

  retry(id: number): void {
    this.queue.retry(id);
  }

  clearUploads(): void {
    this.queue.clearFinished(this.companyId());
  }

  resetFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.categoryFilter.setValue('', { emitEvent: false });
    this.stateFilter.setValue('', { emitEvent: false });
    this.list.filters.set({});
  }

  /**
   * Single files that are not supported show up as errors in the queue.
   * Folders usually contain more than documents; those files are left out and only counted.
   */
  private enqueue(files: File[], fromFolder: boolean): void {
    const extensions = this.store.limits().extensions;
    const accepted = fromFolder
      ? files.filter((f) => !f.name.startsWith('.') && extensions.some((ext) => f.name.toLowerCase().endsWith(ext)))
      : files;
    this.skipped.set(files.length - accepted.length);
    if (accepted.length) this.queue.add(this.companyId(), accepted, this.uploadCategory.value);
  }
}
