import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthService).hasValidSession() ||
  inject(Router).createUrlTree(['/login'], { queryParams: state.url === '/' ? {} : { redirect: state.url } });

/** Signed-in users skip the login screen. */
export const guestGuard: CanActivateFn = () =>
  !inject(AuthService).hasValidSession() || inject(Router).createUrlTree(['/']);

/** Admin pages; the profile may still be loading on a fresh reload. The API checks the role again. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const home = inject(Router).createUrlTree(['/']);
  const user = auth.user();
  if (user) return user.role === 'admin' || home;
  return auth.loadMe().pipe(
    map((me) => me.role === 'admin' || home),
    catchError(() => of(home)),
  );
};
