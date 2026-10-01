import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { MicrosoftApi } from './microsoft-api.service';
import { MicrosoftStatus } from './microsoft.models';

/** Connection state of the signed-in user's Microsoft 365 account, shared by the profile panels. */
@Injectable({ providedIn: 'root' })
export class MicrosoftStore {
  private readonly api = inject(MicrosoftApi);
  private readonly auth = inject(AuthService);

  /** Remembers whose status it is, so it never outlives a sign-out or account switch. */
  private readonly state = signal<{ ownerId: string; status: MicrosoftStatus } | null>(null);

  readonly loadFailed = signal(false);
  readonly status = computed(() => {
    const state = this.state();
    return state && state.ownerId === this.auth.user()?.id ? state.status : null;
  });
  readonly connection = computed(() => this.status()?.connection ?? null);
  readonly connected = computed(() => this.connection()?.status === 'active');

  private inFlight: Observable<MicrosoftStatus> | null = null;

  load(): Observable<MicrosoftStatus> {
    const ownerId = this.auth.user()?.id ?? '';
    this.loadFailed.set(false);
    this.inFlight ??= this.api.status().pipe(
      tap({ next: (status) => this.state.set({ ownerId, status }), error: () => this.loadFailed.set(true) }),
      finalize(() => (this.inFlight = null)),
      shareReplay(1),
    );
    return this.inFlight;
  }

  disconnected(): void {
    this.state.update((s) => s && { ...s, status: { ...s.status, connection: null } });
  }
}
