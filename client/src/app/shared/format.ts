import { HttpErrorResponse } from '@angular/common/http';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const RELATIVE = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

export function formatDate(value: string | null): string {
  return value ? DATE.format(new Date(value)) : '–';
}

export function formatDateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : '–';
}

export function formatTime(value: string): string {
  return TIME.format(new Date(value));
}

/** "Mi., 1. Okt." */
export function formatDay(value: string): string {
  return WEEKDAY.format(new Date(value));
}

/** "heute", "vor 3 Tagen", "vor 2 Monaten"; older than a year as date */
export function formatAgo(value: string | null): string {
  if (!value) return '–';
  const days = Math.round((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days > -1) return 'heute';
  if (days > -30) return RELATIVE.format(days, 'day');
  if (days > -365) return RELATIVE.format(Math.round(days / 30.4), 'month');
  return formatDate(value);
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** Only digits and a leading +, for tel: and callto: links; the "(0)" of "+49 (0)40 …" is not dialled */
export function telOf(phone: string): string {
  return phone
    .trim()
    .replace(/^(\+\d+)\s*\(0\)/, '$1')
    .replace(/(?!^\+)[^\d]/g, '');
}

/** "1 Dokument", "3 Dokumente" */
export function plural(n: number, one: string, many: string): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`;
}

/** Server message if it sent a German one, otherwise the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Keine Verbindung zum Server.';
    const message = (err.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && (err.status < 500 || err.status === 503)) return message;
  }
  return fallback;
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
}

/** Saves a blob under the given name via a temporary link. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
