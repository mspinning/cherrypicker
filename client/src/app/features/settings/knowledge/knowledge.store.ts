import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { GroupCompany, KnowledgeOverview } from '../../../core/knowledge/knowledge.models';

const POLL_MS = 8_000;

/**
 * Companies with their counts and the embedding state, shared by everything
 * inside the knowledge tab. Provided by KnowledgeSettings, so it lives as long
 * as the tab is open.
 */
@Injectable()
export class KnowledgeStore {
  private readonly api = inject(KnowledgeApi);

  readonly overview = signal<KnowledgeOverview | null>(null);
  readonly loadFailed = signal(false);

  readonly companies = computed(() => this.overview()?.companies ?? []);
  readonly embedding = computed(() => this.overview()?.embedding ?? null);
  readonly limits = computed(() => this.overview()?.limits ?? { maxUploadBytes: 50 * 1024 * 1024, extensions: [] });
  readonly totals = computed(() => {
    let sources = 0;
    let chunks = 0;
    let embedded = 0;
    for (const c of this.companies()) {
      sources += c.counts.text + c.counts.url + c.counts.document;
      chunks += c.chunks;
      embedded += c.embeddedChunks;
    }
    return { companies: this.companies().length, sources, chunks, embedded };
  });

  private inFlight: Observable<KnowledgeOverview> | null = null;

  constructor() {
    // Counts move while the server works through the queue
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (this.companies().some((c) => c.pending > 0)) this.refresh();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load(): Observable<KnowledgeOverview> {
    this.loadFailed.set(false);
    this.inFlight ??= this.api.overview().pipe(
      tap({ next: (overview) => this.overview.set(overview), error: () => this.loadFailed.set(true) }),
      finalize(() => (this.inFlight = null)),
      shareReplay(1),
    );
    return this.inFlight;
  }

  /** Silent reload after changes; the old numbers stay if it fails. */
  refresh(): void {
    this.api.overview().subscribe({ next: (overview) => this.overview.set(overview), error: () => {} });
  }

  addCompany(company: GroupCompany): void {
    this.overview.update(
      (o) => o && { ...o, companies: [...o.companies, company].sort((a, b) => a.name.localeCompare(b.name, 'de')) },
    );
  }

  patchCompany(id: string, patch: Partial<GroupCompany>): void {
    this.overview.update(
      (o) =>
        o && {
          ...o,
          companies: o.companies
            .map((c) => (c.id === id ? { ...c, ...patch } : c))
            .sort((a, b) => a.name.localeCompare(b.name, 'de')),
        },
    );
  }

  removeCompany(id: string): void {
    this.overview.update((o) => o && { ...o, companies: o.companies.filter((c) => c.id !== id) });
  }
}
