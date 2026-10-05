import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { CallStore } from '../core/voice/call.store';
import { AppHeader } from './app-header';
import { CallScreen } from './call-screen';

/** Frame for all signed-in pages. */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppHeader, CallScreen, RouterOutlet],
  template: `
    <!-- During a call the page behind it is out of reach for keyboard and screen readers -->
    <div class="page" [inert]="call.open()">
      <app-header />
      <router-outlet />
    </div>
    @if (call.open()) {
      <app-call-screen />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: 100dvh;
      min-height: 640px;
      // glow and flying cards must never widen the page
      overflow-x: clip;
      background-color: var(--bg);
      background-image: radial-gradient(var(--bg-dot) 1px, transparent 1px);
      background-size: 24px 24px;
    }

    .page {
      display: contents;
    }

    @media (min-width: 1180px) {
      :host {
        min-height: 680px;
        background-size: 28px 28px;
      }
    }
  `,
})
export class Shell {
  protected readonly call = inject(CallStore);

  constructor() {
    const auth = inject(AuthService);
    if (!auth.user()) auth.loadMe().subscribe({ error: () => {} });
    this.call.checkAvailability();
  }
}
