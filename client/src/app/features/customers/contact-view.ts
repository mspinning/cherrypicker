import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pastelOf } from '../../core/auth/user-display';
import { CrmApi } from '../../core/crm/crm-api.service';
import { ContactDetail } from '../../core/crm/crm.models';
import { Icon } from '../../shared/icon';
import { errorMessage, formatAgo, formatDate } from '../../shared/format';
import { ActivityList } from './activity-list';
import { initialsOfName, telOf } from './customers-format';

/** One person at a customer, with the own mails exchanged with them. */
@Component({
  selector: 'app-contact-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, ActivityList],
  templateUrl: './contact-view.html',
  styleUrl: './detail.scss',
})
export class ContactView {
  private readonly api = inject(CrmApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly id = input.required<string>();
  /** Opened from a company: "back" returns there instead of to the list */
  readonly backToCompany = input(false);
  /** Emits the company id of the deleted contact */
  readonly removed = output<string | null>();

  readonly contact = signal<ContactDetail | null>(null);
  readonly loadFailed = signal(false);
  readonly confirming = signal(false);
  readonly ignore = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly colorOf = pastelOf;
  protected readonly initials = initialsOfName;
  protected readonly tel = telOf;
  protected readonly date = formatDate;
  protected readonly ago = formatAgo;

  constructor() {
    afterNextRender(() => this.load());
  }

  load(): void {
    this.loadFailed.set(false);
    this.api.contact(this.id()).subscribe({
      next: (contact) => this.contact.set(contact),
      error: () => this.loadFailed.set(true),
    });
  }

  askDelete(): void {
    this.error.set(null);
    this.confirming.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.js-cancel')?.focus(), { injector: this.injector });
  }

  confirmDelete(): void {
    const contact = this.contact();
    if (this.busy() || !contact) return;
    this.busy.set(true);
    this.api.removeContact(contact.id, !contact.company && this.ignore()).subscribe({
      next: () => this.removed.emit(contact.company?.id ?? null),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Der Kontakt konnte nicht gelöscht werden.'));
      },
    });
  }
}
