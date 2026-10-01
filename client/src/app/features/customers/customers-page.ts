import { ChangeDetectionStrategy, Component, DestroyRef, WritableSignal, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { pastelOf } from '../../core/auth/user-display';
import { CrmApi } from '../../core/crm/crm-api.service';
import { CompanyListItem, ContactListItem, CrmSummary, Page, RELATIONSHIP_LABELS, Relationship } from '../../core/crm/crm.models';
import { Viewport } from '../../core/viewport';
import { Icon } from '../../shared/icon';
import { formatAgo, formatNumber, plural } from '../../shared/format';
import { CompanyView } from './company-view';
import { ContactView } from './contact-view';
import { initialsOfName, joined } from './customers-format';

type Tab = 'companies' | 'people';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

/**
 * Customers from the CRM: companies and their people. Selection lives in the
 * query params (?company=, ?contact=, ?tab=people), so it survives reloads.
 */
@Component({
  selector: 'app-customers-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, CompanyView, ContactView],
  templateUrl: './customers-page.html',
  styleUrl: './customers-page.scss',
  host: { '[class.has-selection]': '!!company() || !!contact()' },
})
export class CustomersPage {
  private readonly api = inject(CrmApi);
  private readonly router = inject(Router);
  private readonly viewport = inject(Viewport);

  /** Query params */
  readonly tab = input<string>();
  readonly company = input<string>();
  readonly contact = input<string>();

  readonly activeTab = computed<Tab>(() => (this.tab() === 'people' ? 'people' : 'companies'));
  readonly q = signal('');
  readonly relationship = signal<Relationship | ''>('');
  readonly summary = signal<CrmSummary | null>(null);
  readonly companies = signal<CompanyListItem[]>([]);
  readonly people = signal<ContactListItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadFailed = signal(false);

  readonly count = computed(() => (this.activeTab() === 'companies' ? this.companies().length : this.people().length));
  readonly hasMore = computed(() => this.count() < this.total());
  /** Nothing in the CRM yet (not just no search results) */
  readonly emptyCrm = computed(() => this.summary()?.companies === 0 && this.summary()?.contacts === 0);

  protected readonly relationshipLabels = RELATIONSHIP_LABELS;
  protected readonly ago = formatAgo;
  protected readonly number = formatNumber;
  protected readonly plural = plural;
  protected readonly colorOf = pastelOf;
  protected readonly initials = initialsOfName;
  protected readonly joined = joined;

  private request?: Subscription;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.loadSummary();

    effect(() => {
      this.activeTab();
      this.q();
      this.relationship();
      untracked(() => this.fetch(0));
    });

    // Desktop shows list and details side by side: open the first company instead of an empty half
    effect(() => {
      const first = this.companies()[0];
      if (!this.viewport.isDesktop() || this.activeTab() !== 'companies' || !first || this.company() || this.contact()) return;
      untracked(() => void this.router.navigate([], { queryParams: { company: first.id }, queryParamsHandling: 'merge', replaceUrl: true }));
    });

    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      clearTimeout(this.searchTimer);
    });
  }

  onSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(value.trim()), SEARCH_DELAY_MS);
  }

  loadMore(): void {
    this.fetch(this.count());
  }

  retry(): void {
    this.loadSummary();
    this.fetch(0);
  }

  /** After a delete in the detail pane; its people went with it */
  companyRemoved(id: string): void {
    this.companies.update((list) => list.filter((c) => c.id !== id));
    this.people.update((list) => list.filter((p) => p.company?.id !== id));
    if (this.activeTab() === 'companies') this.total.update((n) => Math.max(0, n - 1));
    this.afterRemove({ company: null, contact: null });
  }

  contactRemoved(id: string, companyId: string | null): void {
    this.people.update((list) => list.filter((p) => p.id !== id));
    this.companies.update((list) => list.map((c) => (c.id === companyId ? { ...c, contactCount: Math.max(0, c.contactCount - 1) } : c)));
    if (this.activeTab() === 'people') this.total.update((n) => Math.max(0, n - 1));
    this.afterRemove({ contact: null });
  }

  private afterRemove(params: Record<string, null>): void {
    this.loadSummary();
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private loadSummary(): void {
    this.api.summary().subscribe({ next: (summary) => this.summary.set(summary), error: () => {} });
  }

  private fetch(offset: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.loadFailed.set(false);
    const query = { q: this.q() || undefined, offset, limit: PAGE_SIZE };
    const done = <T>(target: WritableSignal<T[]>) => (page: Page<T>) => {
      target.update((list) => (offset ? [...list, ...page.items] : page.items));
      this.total.set(page.total);
      this.loading.set(false);
      this.loaded.set(true);
    };
    const failed = () => {
      this.loading.set(false);
      this.loadFailed.set(true);
    };
    this.request =
      this.activeTab() === 'companies'
        ? this.api.companies({ ...query, relationship: this.relationship() }).subscribe({ next: done(this.companies), error: failed })
        : this.api.contacts(query).subscribe({ next: done(this.people), error: failed });
  }
}
