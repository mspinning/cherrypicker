import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { pastelOf } from '../../../core/auth/user-display';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { GroupCompany } from '../../../core/knowledge/knowledge.models';
import { Viewport } from '../../../core/viewport';
import { Icon } from '../../../shared/icon';
import { CompanyForm } from './company-form';
import { CompanyPanel } from './company-panel';
import { KnowledgeStore } from './knowledge.store';
import { formatNumber, plural } from './knowledge-format';
import { UploadQueue } from './upload-queue';

/**
 * Settings tab "Wissensquellen": the companies of the group and what agents
 * should know about them. The selected company is the `company` query param.
 */
@Component({
  selector: 'app-knowledge-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, CompanyForm, CompanyPanel],
  providers: [KnowledgeStore, UploadQueue],
  templateUrl: './knowledge-settings.html',
  styleUrl: './knowledge-settings.scss',
  host: {
    '[class.has-selection]': '!!selected()',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class KnowledgeSettings {
  protected readonly store = inject(KnowledgeStore);
  private readonly queue = inject(UploadQueue);
  private readonly api = inject(KnowledgeApi);
  private readonly router = inject(Router);
  private readonly viewport = inject(Viewport);

  /** Query param ?company= */
  readonly company = input<string>();

  readonly creating = signal(false);
  readonly retrying = signal(false);

  readonly selected = computed(() => this.store.companies().find((c) => c.id === this.company()) ?? null);
  /** Keyed by id, so the panel starts fresh for every company */
  readonly selectedList = computed(() => {
    const selected = this.selected();
    return selected ? [selected] : [];
  });
  readonly vectorShare = computed(() => {
    const t = this.store.totals();
    return t.chunks ? Math.round((t.embedded / t.chunks) * 100) : 0;
  });
  /** Embedding runs into errors while chunks wait for their vectors */
  readonly vectorsBlocked = computed(() => {
    const e = this.store.embedding();
    return !!e && e.pendingChunks > 0 && (!e.configured || !!e.lastError);
  });

  protected readonly plural = plural;
  protected readonly formatNumber = formatNumber;
  protected readonly colorOf = (c: GroupCompany) => pastelOf(c.id);

  constructor() {
    this.reload();

    // Desktop shows list and details side by side: open the first company instead of an empty half
    effect(() => {
      const companies = this.store.companies();
      if (!this.viewport.isDesktop() || !companies.length || this.selected() || this.creating()) return;
      untracked(() => this.open(companies[0].id, true));
    });
  }

  created(company: Pick<GroupCompany, 'id' | 'name' | 'description'> & Partial<GroupCompany>): void {
    this.creating.set(false);
    this.store.addCompany({
      counts: { text: 0, url: 0, document: 0 },
      pending: 0,
      failed: 0,
      chunks: 0,
      embeddedChunks: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...company,
    });
    this.open(company.id);
  }

  reload(): void {
    this.store.load().subscribe({ error: () => {} });
  }

  deleted(): void {
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  retryEmbedding(): void {
    this.retrying.set(true);
    this.api.retryEmbedding().subscribe({
      next: () => setTimeout(() => {
        this.retrying.set(false);
        this.store.refresh();
      }, 1500),
      error: () => this.retrying.set(false),
    });
  }

  countsOf(c: GroupCompany): string {
    const parts = [
      c.counts.text ? plural(c.counts.text, 'Text', 'Texte') : '',
      c.counts.url ? plural(c.counts.url, 'Webseite', 'Webseiten') : '',
      c.counts.document ? plural(c.counts.document, 'Dokument', 'Dokumente') : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'Noch keine Quellen';
  }

  /** Used by the route's canDeactivate guard */
  canLeave(): boolean {
    return !this.queue.busy() || confirm('Es laden noch Dokumente hoch. Seite trotzdem verlassen? Offene Uploads werden abgebrochen.');
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.queue.busy()) event.preventDefault();
  }

  private open(id: string, replaceUrl = false): void {
    void this.router.navigate([], { queryParams: { company: id }, replaceUrl });
  }
}
