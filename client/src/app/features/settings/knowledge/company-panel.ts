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
import { RouterLink } from '@angular/router';
import { pastelOf } from '../../../core/auth/user-display';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { GroupCompany, SourceType } from '../../../core/knowledge/knowledge.models';
import { Icon, IconName } from '../../../shared/icon';
import { CompanyForm } from './company-form';
import { DocumentSources } from './document-sources';
import { KnowledgeStore } from './knowledge.store';
import { errorMessage, plural } from './knowledge-format';
import { TextSources } from './text-sources';
import { UrlSources } from './url-sources';

const VIEWS: readonly { type: SourceType; label: string; icon: IconName }[] = [
  { type: 'text', label: 'Texte', icon: 'text' },
  { type: 'url', label: 'Webseiten', icon: 'link' },
  { type: 'document', label: 'Dokumente', icon: 'file' },
];

/** One group company: name, description and its texts, web pages and documents. */
@Component({
  selector: 'app-company-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, CompanyForm, TextSources, UrlSources, DocumentSources],
  templateUrl: './company-panel.html',
  styleUrl: './company-panel.scss',
})
export class CompanyPanel {
  private readonly api = inject(KnowledgeApi);
  private readonly store = inject(KnowledgeStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly company = input.required<GroupCompany>();
  readonly deleted = output<void>();

  readonly view = signal<SourceType>('text');
  readonly editing = signal(false);
  readonly confirmingDelete = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Bumped to make the open list reload */
  readonly reloadKey = signal(0);

  readonly color = computed(() => pastelOf(this.company().id));
  readonly initials = computed(() => {
    const words = this.company().name.replace(/\b(GmbH|AG|KG|SE|UG|mbH|Co\.?|&)\b/gi, '').trim().split(/\s+/);
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
  });
  readonly total = computed(() => {
    const c = this.company().counts;
    return c.text + c.url + c.document;
  });
  readonly vectorShare = computed(() => {
    const c = this.company();
    return c.chunks ? Math.round((c.embeddedChunks / c.chunks) * 100) : 0;
  });

  protected readonly views = VIEWS;
  protected readonly plural = plural;

  constructor() {
    // Opening a company with nothing but documents lands on them directly
    afterNextRender(() => {
      const c = this.company().counts;
      if (!c.text && (c.document || c.url)) this.view.set(c.document >= c.url ? 'document' : 'url');
    });
  }

  saved(patch: Pick<GroupCompany, 'id' | 'name' | 'description'>): void {
    this.store.patchCompany(patch.id, { name: patch.name, description: patch.description });
    this.editing.set(false);
  }

  askDelete(): void {
    this.error.set(null);
    this.confirmingDelete.set(true);
    this.focusAfterRender('.js-cancel-delete');
  }

  cancelDelete(): void {
    this.confirmingDelete.set(false);
    this.focusAfterRender('.js-delete');
  }

  confirmDelete(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.removeCompany(this.company().id).subscribe({
      next: () => {
        this.busy.set(false);
        this.store.removeCompany(this.company().id);
        this.deleted.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Firma konnte nicht gelöscht werden.'));
      },
    });
  }

  retryFailed(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.reprocessFailed(this.company().id).subscribe({
      next: () => {
        this.busy.set(false);
        this.store.refresh();
        // The open list shows the new status right away instead of at the next poll
        this.reloadKey.update((n) => n + 1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Konnte nicht neu gestartet werden.'));
      },
    });
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
