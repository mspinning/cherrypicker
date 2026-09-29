import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import gsap from 'gsap';
import { Observable } from 'rxjs';
import { CurrentUser, UserRole } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { avatarColorOf, initialsOf, roleLabel } from '../../../core/auth/user-display';
import { UserAdminService } from '../../../core/users/user-admin.service';
import { Icon } from '../../../shared/icon';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const ROLES: readonly UserRole[] = ['user', 'admin'];

/** Settings tab "Benutzer": who is registered, approving, role changes and deleting accounts. */
@Component({
  selector: 'app-users-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './users-settings.html',
  styleUrl: './users-settings.scss',
})
export class UsersSettings {
  private readonly auth = inject(AuthService);
  protected readonly admin = inject(UserAdminService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly loadFailed = signal(false);
  /** Users with a request in flight; their controls are disabled meanwhile. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Briefly highlighted after it changed (approved, new role). */
  readonly highlighted = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly confirmingDelete = signal<string | null>(null);

  readonly meId = computed(() => this.auth.user()?.id);
  readonly total = computed(() => this.admin.users()?.length ?? 0);
  readonly groups = computed(() => [
    { key: 'pending', title: 'Wartet auf Freigabe', users: this.admin.pending(), empty: 'Niemand wartet auf Freigabe.' },
    { key: 'approved', title: 'Freigegeben', users: this.admin.approved(), empty: 'Noch niemand freigegeben.' },
  ]);

  protected readonly roles = ROLES;
  protected readonly initialsOf = initialsOf;
  protected readonly avatarColorOf = avatarColorOf;
  protected readonly roleLabel = roleLabel;

  private gsapContext?: gsap.Context;
  private highlightTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.reload();

    afterNextRender(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.gsapContext = gsap.context(() => {
        gsap.from('.panel', { opacity: 0, y: 30, duration: 0.7, stagger: 0.09, ease: 'power3.out' });
      }, this.host.nativeElement);
    });

    inject(DestroyRef).onDestroy(() => {
      this.gsapContext?.revert();
      clearTimeout(this.highlightTimer);
    });
  }

  reload(): void {
    this.loadFailed.set(false);
    this.admin.load().subscribe({ error: () => this.loadFailed.set(true) });
  }

  approve(user: CurrentUser): void {
    this.run(user, this.admin.approve(user.id), `${this.nameOf(user)} konnte nicht freigegeben werden.`, () =>
      this.highlight(user.id),
    );
  }

  setRole(user: CurrentUser, role: UserRole): void {
    if (user.role === role) return;
    this.run(user, this.admin.setRole(user.id, role), `Die Rolle von ${this.nameOf(user)} konnte nicht geändert werden.`, () =>
      this.highlight(user.id),
    );
  }

  askDelete(user: CurrentUser): void {
    this.actionError.set(null);
    this.confirmingDelete.set(user.id);
    this.focusAfterRender(`#cancel-${user.id}`);
  }

  cancelDelete(user: CurrentUser): void {
    this.confirmingDelete.set(null);
    this.focusAfterRender(`#delete-${user.id}`);
  }

  confirmDelete(user: CurrentUser): void {
    this.run(user, this.admin.remove(user.id), `${this.nameOf(user)} konnte nicht gelöscht werden.`, () =>
      this.confirmingDelete.set(null),
    );
  }

  isBusy(user: CurrentUser): boolean {
    return this.busy().has(user.id);
  }

  nameOf(user: CurrentUser): string {
    return `${user.firstName} ${user.lastName}`.trim() || user.email;
  }

  date(value: string | null): string {
    return value ? DATE.format(new Date(value)) : '–';
  }

  private run(user: CurrentUser, request$: Observable<unknown>, failure: string, onSuccess: () => void): void {
    if (this.isBusy(user)) return;
    this.actionError.set(null);
    this.setBusy(user.id, true);

    request$.subscribe({
      next: () => {
        this.setBusy(user.id, false);
        onSuccess();
      },
      error: (err: unknown) => {
        this.setBusy(user.id, false);
        const status = err instanceof HttpErrorResponse ? err.status : 0;
        const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
        if (code === 'LAST_ADMIN') {
          this.actionError.set('Es muss mindestens ein Admin bleiben. Mach zuerst jemand anderen zum Admin.');
        } else if (status === 404) {
          // Someone else was faster; show the list as it is now
          this.confirmingDelete.set(null);
          this.actionError.set('Dieses Konto gibt es nicht mehr.');
          this.reload();
        } else {
          this.actionError.set(`${failure} Bitte versuch es noch einmal.`);
        }
      },
    });
  }

  private setBusy(id: string, busy: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private highlight(id: string): void {
    this.highlighted.set(id);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlighted.set(null), 2400);
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
