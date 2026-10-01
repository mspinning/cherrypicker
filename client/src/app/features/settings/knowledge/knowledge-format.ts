import { KnowledgeSource } from '../../../core/knowledge/knowledge.models';

export { errorCode, errorMessage, formatDate, formatNumber, plural, saveBlob } from '../../../shared/format';

const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(bytes / 1024)} KB`;
  return `${NUMBER.format(bytes / 1024 / 1024)} MB`;
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
