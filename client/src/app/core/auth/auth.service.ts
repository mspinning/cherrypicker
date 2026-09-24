import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, finalize, map, shareReplay, switchMap, tap, throwError, catchError } from 'rxjs';
import { CurrentUser, RegisterRequest, Session, TokenResponse } from './auth.models';

export const API_URL = '/api';

const STORAGE_KEY = 'cherrypick.session';
/** Refresh the access token this long before it actually expires. */
const EXPIRY_MARGIN_MS = 15_000;

/**
 * Login, registration and token handling against the NestJS backend
 * (which in turn talks to Keycloak). The session survives reloads via localStorage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly session = signal<Session | null>(readStoredSession());
  readonly user = signal<CurrentUser | null>(null);
  readonly displayName = computed(() => {
    const u = this.user();
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : '';
  });

  private refreshInFlight: Observable<Session> | null = null;
  private meInFlight: Observable<CurrentUser> | null = null;

  hasValidSession(): boolean {
    const session = this.session();
    return !!session && session.refreshExpiresAt > Date.now();
  }

  accessTokenExpired(): boolean {
    const session = this.session();
    return !session || session.expiresAt - EXPIRY_MARGIN_MS < Date.now();
  }

  login(email: string, password: string): Observable<CurrentUser> {
    return this.http.post<TokenResponse>(`${API_URL}/auth/login`, { email, password }).pipe(
      tap((tokens) => this.storeSession(toSession(tokens))),
      switchMap(() => this.loadMe()),
    );
  }

  /** Creates the account, then signs in with the same credentials. */
  register(request: RegisterRequest): Observable<CurrentUser> {
    return this.http
      .post<CurrentUser>(`${API_URL}/auth/register`, request)
      .pipe(switchMap(() => this.login(request.email, request.password)));
  }

  /** Shared while in flight, so shell and pages can both ask for it. */
  loadMe(): Observable<CurrentUser> {
    this.meInFlight ??= this.http.get<CurrentUser>(`${API_URL}/users/me`).pipe(
      tap((user) => this.user.set(user)),
      finalize(() => (this.meInFlight = null)),
      shareReplay(1),
    );
    return this.meInFlight;
  }

  /** Single-flight: parallel 401s share one refresh request. */
  refresh(): Observable<Session> {
    const session = this.session();
    if (!session) return throwError(() => new Error('No session'));

    this.refreshInFlight ??= this.http
      .post<TokenResponse>(`${API_URL}/auth/refresh`, { refreshToken: session.refreshToken })
      .pipe(
        map(toSession),
        tap((next) => this.storeSession(next)),
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && (err.status === 400 || err.status === 401)) this.endSession();
          return throwError(() => err);
        }),
        finalize(() => (this.refreshInFlight = null)),
        shareReplay(1),
      );
    return this.refreshInFlight;
  }

  logout(): void {
    const session = this.session();
    if (session) {
      // Best effort: the local session ends either way
      this.http.post(`${API_URL}/auth/logout`, { refreshToken: session.refreshToken }).subscribe({ error: () => {} });
    }
    this.endSession();
  }

  private endSession(): void {
    this.clearSession();
    void this.router.navigate(['/login']);
  }

  private storeSession(session: Session): void {
    this.session.set(session);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // storage unavailable (private mode): session lives in memory only
    }
  }

  private clearSession(): void {
    this.session.set(null);
    this.user.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

function toSession(tokens: TokenResponse): Session {
  const now = Date.now();
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: now + tokens.expiresIn * 1000,
    refreshExpiresAt: now + tokens.refreshExpiresIn * 1000,
  };
}

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    return session && session.refreshExpiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}
