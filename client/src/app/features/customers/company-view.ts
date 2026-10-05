import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pastelOf } from '../../core/auth/user-display';
import { CrmApi } from '../../core/crm/crm-api.service';
import { CompanyDetail, RELATIONSHIP_LABELS } from '../../core/crm/crm.models';
import { Icon } from '../../shared/icon';
import { errorMessage, formatAgo, formatDate, plural, telOf } from '../../shared/format';
import { ActivityList } from './activity-list';
import { NoteList } from './note-list';
import { addressOf, initialsOfName } from './customers-format';

/** One customer company: master data, relationship, people and the own mails with them. */
@Component({
  selector: 'app-company-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, ActivityList, NoteList],
  templateUrl: './company-view.html',
  styleUrl: './detail.scss',
})
export class CompanyView {
  private readonly api = inject(CrmApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly id = input.required<string>();
  readonly removed = output<void>();

  readonly company = signal<CompanyDetail | null>(null);
  readonly loadFailed = signal(false);
  readonly confirming = signal(false);
  /** Keeps the import from creating it again */
  readonly ignore = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly address = computed(() => {
    const c = this.company();
    return c ? addressOf(c) : '';
  });
  readonly websiteLabel = computed(() => {
    const url = this.company()?.website;
    return url ? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  });

  protected readonly relationshipLabels = RELATIONSHIP_LABELS;
  protected readonly colorOf = pastelOf;
  protected readonly initials = initialsOfName;
  protected readonly tel = telOf;
  protected readonly date = formatDate;
  protected readonly ago = formatAgo;
  protected readonly plural = plural;

  constructor() {
    afterNextRender(() => this.load());
  }

  load(): void {
    this.loadFailed.set(false);
    this.api.company(this.id()).subscribe({
      next: (company) => this.company.set(company),
      error: () => this.loadFailed.set(true),
    });
  }

  askDelete(): void {
    this.error.set(null);
    this.confirming.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.js-cancel')?.focus(), { injector: this.injector });
  }

  confirmDelete(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.removeCompany(this.id(), this.ignore()).subscribe({
      next: () => this.removed.emit(),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Firma konnte nicht gelöscht werden.'));
      },
    });
  }
}
