import { Injectable, signal } from '@angular/core';

/** Must match $desktop-min in styles/_mixins.scss */
export const DESKTOP_QUERY = '(min-width: 1180px)';

@Injectable({ providedIn: 'root' })
export class Viewport {
  private readonly query = window.matchMedia(DESKTOP_QUERY);

  readonly isDesktop = signal(this.query.matches);

  constructor() {
    this.query.addEventListener('change', (event) => this.isDesktop.set(event.matches));
  }
}
