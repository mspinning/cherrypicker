import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, WritableSignal, computed, effect, inject, input, signal, untracked } from '@angular/core';
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
import { Pager } from './pager';

type Tab = 'companies' | 'people';

const PAGE_SIZE = 10;
const SEARCH_DELAY_MS = 250;

/**
 * Customers from the CRM: companies and their people. Selection lives in the
 * query params (?company=, ?contact=, ?tab=people), so it survives reloads.
 */
@Component({
  selector: 'app-customers-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, CompanyView, ContactView, Pager],
  templateUrl: './customers-page.html',
  styleUrl: './customers-page.scss',
  host: { '[class.has-selection]': '!!company() || !!contact()' },
})
export class CustomersPage {
  private readonly api = inject(CrmApi);
  private readonly router = inject(Router);
  private readonly viewport = inject(Viewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Query params */
  readonly tab = input<string>();
  readonly company = input<string>();
  readonly contact = input<string>();

  readonly activeTab = computed<Tab>(() => (this.tab() === 'people' ? 'people' : 'companies'));
  readonly q = signal('');
  readonly relationship = signal<Relationship | ''>('');
  /** 0-based */
  readonly page = signal(0);
  readonly summary = signal<CrmSummary | null>(null);
  readonly companies = signal<CompanyListItem[]>([]);
  readonly people = signal<ContactListItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadFailed = signal(false);

  readonly count = computed(() => (this.activeTab() === 'companies' ? this.companies().length : this.people().length));
  /** Nothing in the CRM yet (not just no search results) */
  readonly emptyCrm = computed(() => this.summary()?.companies === 0 && this.summary()?.contacts === 0);

  protected readonly relationshipLabels = RELATIONSHIP_LABELS;
  protected readonly ago = formatAgo;
  protected readonly number = formatNumber;
  protected readonly plural = plural;
  protected readonly colorOf = pastelOf;
  protected readonly initials = initialsOfName;
  protected readonly joined = joined;
  protected readonly pageSize = PAGE_SIZE;

  private request?: Subscription;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.loadSummary();

    // Another tab, search or filter starts again on page 1
    let lastFilter = '';
    effect(() => {
      const filter = `${this.activeTab()}|${this.q()}|${this.relationship()}`;
      const page = this.page();
      untracked(() => {
        if (filter !== lastFilter) {
          lastFilter = filter;
          if (page !== 0) return this.page.set(0);
        }
        this.fetch(page);
      });
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

  goTo(page: number): void {
    this.page.set(page);
    // Phones: the pager sits below the list, the new page starts above
    if (!this.viewport.isDesktop()) this.host.nativeElement.querySelector('.side')?.scrollIntoView({ block: 'start' });
  }

  retry(): void {
    this.loadSummary();
    this.fetch(this.page());
  }

  /** After a delete in the detail pane: reload the page, so it fills up to 10 again (its people went with a company) */
  removed(params: Record<string, null>): void {
    this.loadSummary();
    this.fetch(this.page());
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private loadSummary(): void {
    this.api.summary().subscribe({ next: (summary) => this.summary.set(summary), error: () => {} });
  }

  private fetch(page: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.loadFailed.set(false);
    const query = { q: this.q() || undefined, offset: page * PAGE_SIZE, limit: PAGE_SIZE };
    const done = <T>(target: WritableSignal<T[]>) => (result: Page<T>) => {
      // The last entry of the last page was deleted: show the page before
      if (!result.items.length && result.total && page > 0) {
        this.page.set(Math.ceil(result.total / PAGE_SIZE) - 1);
        return;
      }
      target.set(result.items);
      this.total.set(result.total);
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
