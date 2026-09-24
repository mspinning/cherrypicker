import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { initialsOf } from '../core/auth/user-display';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
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
      <a
        class="avatar"
        routerLink="/profile"
        routerLinkActive="is-active"
        [attr.aria-label]="auth.displayName() ? 'Profil von ' + auth.displayName() : 'Profil'"
      >
        {{ initials() || '··' }}
      </a>
    </header>
  `,
  styleUrl: './app-header.scss',
})
export class AppHeader {
  protected readonly auth = inject(AuthService);
  protected readonly initials = computed(() => initialsOf(this.auth.user()));
}
