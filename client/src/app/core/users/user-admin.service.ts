import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { API_URL, AuthService } from '../auth/auth.service';
import { CurrentUser, UserRole } from '../auth/auth.models';

/**
 * Admin view of all registered accounts. Shared by the settings page and
 * the header badge that counts accounts waiting for approval.
 */
@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** Remembers who loaded the list, so it never outlives a sign-out or account switch. */
  private readonly state = signal<{ ownerId: string; users: CurrentUser[] } | null>(null);

  readonly users = computed(() => {
    const state = this.state();
    return state && state.ownerId === this.auth.user()?.id ? state.users : null;
  });
  readonly pending = computed(() => (this.users() ?? []).filter((u) => !u.approved));
  readonly approved = computed(() => (this.users() ?? []).filter((u) => u.approved));

  private loadInFlight: Observable<CurrentUser[]> | null = null;

  load(): Observable<CurrentUser[]> {
    const ownerId = this.auth.user()?.id ?? '';
    this.loadInFlight ??= this.http.get<CurrentUser[]>(`${API_URL}/users`).pipe(
      tap((users) => this.state.set({ ownerId, users })),
      finalize(() => (this.loadInFlight = null)),
      shareReplay(1),
    );
    return this.loadInFlight;
  }

  approve(id: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>(`${API_URL}/users/${id}/approve`, {}).pipe(tap((updated) => this.replace(updated)));
  }

  setRole(id: string, role: UserRole): Observable<CurrentUser> {
    return this.http.patch<CurrentUser>(`${API_URL}/users/${id}/role`, { role }).pipe(tap((updated) => this.replace(updated)));
  }

  /** Also removes the Keycloak account – cannot be undone. */
  remove(id: string): Observable<void> {
    return this.http
      .delete<void>(`${API_URL}/users/${id}`)
      .pipe(tap(() => this.state.update((state) => state && { ...state, users: state.users.filter((u) => u.id !== id) })));
  }

  private replace(updated: CurrentUser): void {
    this.state.update((state) => state && { ...state, users: state.users.map((u) => (u.id === updated.id ? updated : u)) });
  }
}
