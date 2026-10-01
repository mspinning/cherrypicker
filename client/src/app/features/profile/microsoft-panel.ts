import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MicrosoftApi } from '../../core/microsoft/microsoft-api.service';
import { CONNECT_ERRORS, CalendarEvent } from '../../core/microsoft/microsoft.models';
import { MicrosoftStore } from '../../core/microsoft/microsoft.store';
import { Icon } from '../../shared/icon';
import { errorCode, errorMessage, formatDate, formatDay, formatTime } from '../../shared/format';

const AGENDA_DAYS = 7;
const AGENDA_ITEMS = 4;

/** Profile panel: link the Microsoft 365 account, show its state and the next appointments. */
@Component({
  selector: 'app-microsoft-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet],
  templateUrl: './microsoft-panel.html',
  styleUrl: './microsoft-panel.scss',
})
export class MicrosoftPanel {
  protected readonly store = inject(MicrosoftStore);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(MicrosoftApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly flash = signal<{ text: string; error: boolean } | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirming = signal(false);
  readonly events = signal<CalendarEvent[] | null>(null);
  readonly eventsFailed = signal(false);

  protected readonly date = formatDate;
  protected readonly day = formatDay;
  protected readonly time = formatTime;

  constructor() {
    this.reload();
    this.readCallbackResult();

    // Appointments as soon as (and whenever) the account is connected
    effect(() => {
      if (this.store.connected()) untracked(() => this.loadEvents());
      else untracked(() => this.events.set(null));
    });
  }

  reload(): void {
    this.store.load().subscribe({ error: () => {} });
  }

  /** The sign-in happens on Microsoft's page; it redirects back to /profile. */
  connect(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.connect().subscribe({
      next: ({ url }) => window.location.assign(url),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Anmeldung bei Microsoft konnte nicht gestartet werden.'));
      },
    });
  }

  askDisconnect(): void {
    this.confirming.set(true);
    this.focusAfterRender('.js-cancel');
  }

  cancelDisconnect(): void {
    this.confirming.set(false);
    this.focusAfterRender('.js-disconnect');
  }

  disconnect(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.disconnect().subscribe({
      next: () => {
        this.busy.set(false);
        this.confirming.set(false);
        this.store.disconnected();
        this.flash.set({ text: 'Die Verbindung zu Microsoft 365 ist getrennt.', error: false });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Verbindung konnte nicht getrennt werden.'));
      },
    });
  }

  private loadEvents(): void {
    const from = new Date();
    const to = new Date(from.getTime() + AGENDA_DAYS * 86_400_000);
    this.eventsFailed.set(false);
    this.api.events(from, to).subscribe({
      next: (events) => this.events.set(events.filter((e) => !e.isCancelled).slice(0, AGENDA_ITEMS)),
      error: (err: unknown) => {
        this.eventsFailed.set(true);
        // Microsoft ended the access meanwhile: show "expired" right away
        if (errorCode(err) === 'MICROSOFT_REAUTH_REQUIRED') this.reload();
      },
    });
  }

  /** /profile?microsoft=connected|error&reason=… after the redirect back from Microsoft */
  private readCallbackResult(): void {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const result = params.get('microsoft');
    if (!result) return;
    this.flash.set(
      result === 'connected'
        ? { text: 'Microsoft 365 ist verbunden. Starte jetzt den Import deiner Kunden.', error: false }
        : { text: CONNECT_ERRORS[params.get('reason') ?? ''] ?? CONNECT_ERRORS['failed'], error: true },
    );
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector });
  }
}
