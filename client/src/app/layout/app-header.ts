import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { initialsOf } from '../core/auth/user-display';
import { LinkedInStore } from '../core/linkedin/linkedin.store';
import { UserAdminService } from '../core/users/user-admin.service';
import { CallStore } from '../core/voice/call.store';
import { Icon } from '../shared/icon';
import { LinkedInPanel } from './linkedin-panel';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon, LinkedInPanel],
  host: { '(document:pointerdown)': 'closeLinkedInOutside($event)' },
  template: `
    <header class="header">
      <a class="brand" routerLink="/" aria-label="Cherrypick – Heute">
        <svg class="brand__mark" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path d="M9.5 19C10.5 12.5 14.5 7.5 21 4.5" stroke="#F4F1EA" stroke-width="1.6" stroke-linecap="round" />
          <path d="M20.5 19.5C19.5 13 19.8 8.5 21 4.5" stroke="#F4F1EA" stroke-width="1.6" stroke-linecap="round" />
          <path d="M21 4.5c3.2-.4 5.6.9 6.8 3.2-2.7 1-5.3.3-6.8-3.2z" fill="#C8F169" />
          <circle cx="9" cy="22.5" r="5.8" fill="#FF7A55" />
          <circle cx="20.8" cy="23" r="5.3" fill="#F4F1EA" />
        </svg>
        <span class="brand__name">Cherry<em>pick</em></span>
      </a>
      <nav class="nav" aria-label="Hauptmenü">
        <a
          class="nav__link is-home"
          routerLink="/"
          routerLinkActive="is-active"
          [routerLinkActiveOptions]="{ exact: true }"
          ariaCurrentWhenActive="page"
        >
          <app-icon name="meeting" [size]="18" />
          <span class="nav__label">Heute</span>
        </a>
        <a class="nav__link" routerLink="/customers" routerLinkActive="is-active" ariaCurrentWhenActive="page" aria-label="Kunden">
          <app-icon name="building" [size]="18" />
          <span class="nav__label" aria-hidden="true">Kunden</span>
        </a>
      </nav>
      <div class="actions">
        @if (call.available()) {
          <button type="button" class="round call" aria-label="Cherry anrufen: per Sprache von einem Kunden berichten" (click)="call.start()">
            <app-icon name="call" [size]="19" />
            <span class="call__word" aria-hidden="true">Cherry anrufen</span>
          </button>
        }
        <button
          #linkedInButton
          type="button"
          class="round linkedin"
          [class.is-active]="linkedInOpen()"
          aria-haspopup="dialog"
          [attr.aria-expanded]="linkedInOpen()"
          [attr.aria-label]="linkedInLabel()"
          (click)="toggleLinkedIn()"
          (keydown.escape)="closeLinkedIn()"
        >
          <span class="linkedin__word" aria-hidden="true">Linked</span>
          <svg class="linkedin__bug" viewBox="0 0 20 20" aria-hidden="true">
            <rect width="20" height="20" rx="3.5" fill="#0A66C2" />
            <circle cx="5.6" cy="5.3" r="1.5" fill="#fff" />
            <path d="M5.6 8.3v7.6M10.1 15.9V8.3m0 3.3c0-2 1.1-3.3 2.8-3.3s2.8 1.2 2.8 3.3v4.3" stroke="#fff" stroke-width="2.5" fill="none" />
          </svg>
          @if (linkedIn.unread()) {
            <span class="badge" aria-hidden="true">{{ linkedIn.unread() }}</span>
          }
        </button>
        @if (auth.isAdmin()) {
          <a class="round settings" routerLink="/settings" routerLinkActive="is-active" [attr.aria-label]="settingsLabel()">
            <app-icon name="settings" [size]="20" />
            @if (pendingCount()) {
              <span class="badge" aria-hidden="true">{{ pendingCount() }}</span>
            }
          </a>
        }
        <a
          class="round avatar"
          routerLink="/profile"
          routerLinkActive="is-active"
          [attr.aria-label]="auth.displayName() ? 'Profil von ' + auth.displayName() : 'Profil'"
        >
          {{ initials() || '··' }}
        </a>
      </div>
      @if (linkedInOpen()) {
        <app-linkedin-panel (closed)="closeLinkedIn()" />
      }
    </header>
  `,
  styleUrl: './app-header.scss',
})
export class AppHeader {
  protected readonly auth = inject(AuthService);
  private readonly userAdmin = inject(UserAdminService);
  protected readonly linkedIn = inject(LinkedInStore);
  protected readonly call = inject(CallStore);

  private readonly linkedInButton = viewChild.required<ElementRef<HTMLButtonElement>>('linkedInButton');
  private readonly linkedInPanel = viewChild(LinkedInPanel, { read: ElementRef });
  protected readonly linkedInOpen = signal(false);

  protected readonly initials = computed(() => initialsOf(this.auth.user()));
  protected readonly pendingCount = computed(() => this.userAdmin.pending().length);
  protected readonly settingsLabel = computed(() => {
    const n = this.pendingCount();
    if (!n) return 'Einstellungen';
    return `Einstellungen – ${n} ${n === 1 ? 'Konto wartet' : 'Konten warten'} auf Freigabe`;
  });
  protected readonly linkedInLabel = computed(() => {
    const n = this.linkedIn.unread();
    return n ? `LinkedIn – ${n} ${n === 1 ? 'neue Nachricht' : 'neue Nachrichten'}` : 'LinkedIn-Nachrichten prüfen';
  });

  constructor() {
    // Admins see at a glance whether someone waits for approval
    effect(() => {
      if (this.auth.isAdmin()) untracked(() => this.userAdmin.load().subscribe({ error: () => {} }));
    });
  }

  /** Opening means checking: install hint, progress and inbox all show in the panel. */
  protected toggleLinkedIn(): void {
    if (this.linkedInOpen()) {
      this.linkedInOpen.set(false);
      return;
    }
    this.linkedInOpen.set(true);
    void this.linkedIn.check();
  }

  protected closeLinkedIn(): void {
    this.linkedInOpen.set(false);
    this.linkedInButton().nativeElement.focus();
  }

  protected closeLinkedInOutside(event: PointerEvent): void {
    const target = event.target as Node;
    if (!this.linkedInOpen() || this.linkedInButton().nativeElement.contains(target)) return;
    if (this.linkedInPanel()?.nativeElement.contains(target)) return;
    this.linkedInOpen.set(false);
  }
}
