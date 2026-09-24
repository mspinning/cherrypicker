import { HttpErrorResponse } from '@angular/common/http';

export type AuthMode = 'login' | 'register';

/** Turns backend / Keycloak errors into something a person can act on. */
export function describeAuthError(err: unknown, mode: AuthMode): string {
  if (!(err instanceof HttpErrorResponse)) return 'Etwas ist schiefgelaufen. Bitte versuch es noch einmal.';

  if (err.status === 0 || err.status === 504) return 'Der Server ist nicht erreichbar. Läuft das Backend?';
  if (err.status === 401) return 'E-Mail oder Passwort stimmt nicht.';
  if (err.status === 409) return 'Zu dieser E-Mail gibt es schon ein Konto. Melde dich einfach an.';
  if (err.status === 400) {
    const raw = (err.error as { message?: string | string[] } | null)?.message;
    const message = (Array.isArray(raw) ? raw.join(' ') : (raw ?? '')).toLowerCase();
    if (message.includes('password')) return 'Das Passwort erfüllt die Richtlinie nicht: mindestens 8 Zeichen und nicht gleich deiner E-Mail.';
    if (message.includes('email')) return 'Bitte gib eine gültige E-Mail-Adresse ein.';
    return mode === 'register' ? 'Bitte prüf deine Angaben.' : 'E-Mail oder Passwort stimmt nicht.';
  }
  return 'Die Anmeldung ist gerade nicht möglich. Bitte versuch es gleich noch einmal.';
}

export interface PasswordStrength {
  /** 0–10, drawn like the confidence bars on the cards */
  bars: number;
  label: string;
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { bars: 0, label: '' };
  if (password.length < 8) return { bars: Math.min(3, Math.ceil(password.length / 3)), label: 'zu kurz' };

  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const score = Math.min(10, 3 + Math.floor((password.length - 8) / 2) + variety * 1.5);
  const bars = Math.round(score);
  return { bars, label: bars >= 9 ? 'stark' : bars >= 6 ? 'gut' : 'okay' };
}
