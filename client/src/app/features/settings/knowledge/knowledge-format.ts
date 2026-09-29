import { HttpErrorResponse } from '@angular/common/http';
import { KnowledgeSource } from '../../../core/knowledge/knowledge.models';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatDate(value: string | null): string {
  return value ? DATE.format(new Date(value)) : '–';
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(bytes / 1024)} KB`;
  return `${NUMBER.format(bytes / 1024 / 1024)} MB`;
}

/** "1 Dokument", "3 Dokumente" */
export function plural(n: number, one: string, many: string): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`;
}

/** Short status text; `vectorsPaused` when Bifrost currently refuses embeddings. */
export function statusLabel(source: KnowledgeSource, vectorsPaused: boolean): string {
  switch (source.status) {
    case 'queued':
      return source.type === 'url' ? 'Wartet auf Abruf' : 'In Warteschlange';
    case 'processing':
      return source.type === 'url' ? 'Wird abgerufen' : source.type === 'document' ? 'Wird gelesen' : 'Wird verarbeitet';
    case 'embedding':
      return vectorsPaused ? 'Wartet auf Vektoren' : 'Wird vektorisiert';
    case 'ready':
      return 'Bereit';
    case 'failed':
      return 'Fehler';
  }
}

/** Server message if it sent a German one, otherwise the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Keine Verbindung zum Server.';
    const message = (err.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && err.status < 500) return message;
  }
  return fallback;
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
}

/** Saves a blob under the given name via a temporary link. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
