import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthService).hasValidSession() ||
  inject(Router).createUrlTree(['/login'], { queryParams: state.url === '/' ? {} : { redirect: state.url } });

/** Signed-in users skip the login screen. */
export const guestGuard: CanActivateFn = () =>
  !inject(AuthService).hasValidSession() || inject(Router).createUrlTree(['/']);
