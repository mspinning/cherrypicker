import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, map, of, switchMap, throwError } from 'rxjs';
import { API_URL, AuthService } from './auth.service';

/**
 * Adds the bearer token to API calls. Refreshes an expiring token up front
 * and retries once after a 401.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_URL) || req.url.startsWith(`${API_URL}/auth/`)) return next(req);

  const auth = inject(AuthService);
  const session = auth.session();
  if (!session) return next(req);

  const send = (token: string) => next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  const token$ = auth.accessTokenExpired() ? auth.refresh().pipe(map((s) => s.accessToken)) : of(session.accessToken);

  return token$.pipe(
    switchMap((token) =>
      send(token).pipe(
        catchError((err: unknown) =>
          err instanceof HttpErrorResponse && err.status === 401
            ? auth.refresh().pipe(switchMap((s) => send(s.accessToken)))
            : throwError(() => err),
        ),
      ),
    ),
  );
};
