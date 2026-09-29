export type SourceType = 'text' | 'url' | 'document';
export type SourceCategory = 'service' | 'offer' | 'reference' | 'pricing' | 'company' | 'other';
export type SourceStatus = 'queued' | 'processing' | 'embedding' | 'ready' | 'failed';

/** One company of the group, entry of GET /api/knowledge */
export interface GroupCompany {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  counts: Record<SourceType, number>;
  /** Sources still being fetched, read or embedded */
  pending: number;
  failed: number;
  chunks: number;
  embeddedChunks: number;
}

export interface EmbeddingState {
  model: string;
  dimensions: number;
  configured: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Chunks waiting for a vector */
  pendingChunks: number;
}

export interface KnowledgeOverview {
  companies: GroupCompany[];
  embedding: EmbeddingState;
  limits: { maxUploadBytes: number; extensions: string[] };
}

export interface KnowledgeSource {
  id: string;
  companyId: string;
  type: SourceType;
  category: SourceCategory;
  title: string;
  excerpt: string;
  charCount: number;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  pageCount: number | null;
  status: SourceStatus;
  error: string | null;
  chunkCount: number;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only from GET /api/knowledge/sources/:id */
  content?: string;
}

export interface SourcePage {
  items: KnowledgeSource[];
  total: number;
}

export interface SourceQuery {
  type: SourceType;
  category?: SourceCategory | '';
  state?: 'pending' | 'failed' | 'ready' | '';
  q?: string;
  offset?: number;
  limit?: number;
}

export interface CreateUrlsResult {
  created: KnowledgeSource[];
  duplicates: string[];
  invalid: string[];
}

export const CATEGORIES: readonly { value: SourceCategory; label: string }[] = [
  { value: 'service', label: 'Leistung' },
  { value: 'offer', label: 'Angebot' },
  { value: 'reference', label: 'Referenz' },
  { value: 'pricing', label: 'Preise' },
  { value: 'company', label: 'Unternehmen' },
  { value: 'other', label: 'Sonstiges' },
];

export function categoryLabel(category: SourceCategory): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

/** Still moving through the pipeline, worth polling for. */
export function isPending(source: KnowledgeSource): boolean {
  return source.status === 'queued' || source.status === 'processing' || source.status === 'embedding';
}

/** Must match MAX_TEXT_CHARS on the server */
export const MAX_TEXT_CHARS = 200_000;
