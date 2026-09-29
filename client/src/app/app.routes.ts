import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth/auth.guards';
import { canLeaveGuard } from './core/can-leave.guard';
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
      {
        path: 'settings',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'users' },
          {
            path: 'users',
            loadComponent: () => import('./features/settings/users/users-settings').then((m) => m.UsersSettings),
            title: 'Cherrypick – Benutzer',
          },
          {
            // ?company=<id> selects a company; a query param keeps the component alive while switching
            path: 'knowledge',
            loadComponent: () => import('./features/settings/knowledge/knowledge-settings').then((m) => m.KnowledgeSettings),
            canDeactivate: [canLeaveGuard],
            title: 'Cherrypick – Wissensquellen',
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
