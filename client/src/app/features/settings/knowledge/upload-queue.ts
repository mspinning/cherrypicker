import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { SourceCategory } from '../../../core/knowledge/knowledge.models';
import { KnowledgeStore } from './knowledge.store';
import { errorCode, errorMessage, formatBytes } from './knowledge-format';

/** Parallel uploads; more mostly competes for the same bandwidth. */
const CONCURRENCY = 3;

export type UploadState = 'waiting' | 'uploading' | 'done' | 'duplicate' | 'error';

export interface UploadItem {
  id: number;
  companyId: string;
  category: SourceCategory;
  file: File;
  /** 0–1 */
  progress: number;
  state: UploadState;
  message?: string;
  /** false when another attempt would fail the same way (type, size) */
  retryable?: boolean;
}

/**
 * Uploads documents one request per file, a few at a time. Lives as long as
 * the knowledge tab, so switching companies does not cancel running uploads.
 */
@Injectable()
export class UploadQueue {
  private readonly api = inject(KnowledgeApi);
  private readonly store = inject(KnowledgeStore);

  readonly items = signal<UploadItem[]>([]);
  readonly busy = computed(() => this.items().some((i) => i.state === 'waiting' || i.state === 'uploading'));
  /** Bumped per company whenever a file arrived, lists reload on it */
  readonly arrivals = signal<Record<string, number>>({});

  private nextId = 1;
  private readonly running = new Map<number, Subscription>();
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.running.forEach((sub) => sub.unsubscribe());
      clearTimeout(this.refreshTimer);
    });
  }

  add(companyId: string, files: File[], category: SourceCategory): void {
    const { maxUploadBytes, extensions } = this.store.limits();
    const added = files.map((file): UploadItem => {
      const item: UploadItem = { id: this.nextId++, companyId, category, file, progress: 0, state: 'waiting' };
      const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
      if (extensions.length && !extensions.includes(extension)) {
        return { ...item, state: 'error', message: 'Dateityp wird nicht unterstützt', retryable: false };
      }
      if (file.size > maxUploadBytes) {
        return { ...item, state: 'error', message: `Größer als ${formatBytes(maxUploadBytes)}`, retryable: false };
      }
      if (file.size === 0) {
        return { ...item, state: 'error', message: 'Die Datei ist leer', retryable: false };
      }
      return item;
    });
    this.items.update((items) => [...items, ...added]);
    this.pump();
  }

  retry(id: number): void {
    this.patch(id, { state: 'waiting', progress: 0, message: undefined });
    this.pump();
  }

  /** Removes finished entries of a company (successful, duplicates and errors). */
  clearFinished(companyId: string): void {
    this.items.update((items) =>
      items.filter((i) => i.companyId !== companyId || i.state === 'waiting' || i.state === 'uploading'),
    );
  }

  private pump(): void {
    for (const item of this.items()) {
      if (this.running.size >= CONCURRENCY) return;
      if (item.state === 'waiting' && !this.running.has(item.id)) this.start(item);
    }
  }

  private start(item: UploadItem): void {
    this.patch(item.id, { state: 'uploading', progress: 0 });
    const sub = this.api.upload(item.companyId, item.file, item.category).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.patch(item.id, { progress: event.loaded / event.total });
        }
        if (event.type === HttpEventType.Response) {
          this.patch(item.id, { state: 'done', progress: 1 });
        }
      },
      error: (err: unknown) => {
        this.finish(item);
        if (errorCode(err) === 'DUPLICATE_FILE') {
          this.patch(item.id, { state: 'duplicate', message: 'Schon vorhanden' });
        } else if (err instanceof HttpErrorResponse && err.status === 413) {
          const message = `Größer als ${formatBytes(this.store.limits().maxUploadBytes)}`;
          this.patch(item.id, { state: 'error', message, retryable: false });
        } else {
          const rejected = err instanceof HttpErrorResponse && err.status === 400;
          this.patch(item.id, { state: 'error', message: errorMessage(err, 'Upload fehlgeschlagen'), retryable: !rejected });
        }
      },
      complete: () => {
        this.finish(item);
        this.arrivals.update((a) => ({ ...a, [item.companyId]: (a[item.companyId] ?? 0) + 1 }));
      },
    });
    this.running.set(item.id, sub);
  }

  private finish(item: UploadItem): void {
    this.running.delete(item.id);
    this.pump();
    // Company counts: once per burst, not per file
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.store.refresh(), 1200);
  }

  private patch(id: number, patch: Partial<UploadItem>): void {
    this.items.update((items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
}
