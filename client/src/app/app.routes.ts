import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { Shell } from './layout/shell';

const authPage = () => import('./features/auth/auth-page').then((m) => m.AuthPage);

export const routes: Routes = [
  { path: 'login', loadComponent: authPage, canActivate: [guestGuard], data: { mode: 'login' }, title: 'Cherrypick – Anmelden' },
  { path: 'register', loadComponent: authPage, canActivate: [guestGuard], data: { mode: 'register' }, title: 'Cherrypick – Registrieren' },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./features/today/today-page').then((m) => m.TodayPage), title: 'Cherrypick – Heute' },
      { path: 'profile', loadComponent: () => import('./features/profile/profile-page').then((m) => m.ProfilePage), title: 'Cherrypick – Profil' },
    ],
  },
  { path: '**', redirectTo: '' },
];
