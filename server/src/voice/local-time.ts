/** Wall-clock time in the caller's time zone: the agent talks and plans in it, the database stores UTC. */

const FALLBACK_ZONE = 'Europe/Berlin';

/** The zone if Intl knows it, otherwise German time. */
export function validTimeZone(zone: string | undefined): string {
  if (!zone) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_ZONE;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

function partsIn(zone: string, date: Date): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')),
  };
}

/** The moment at which clocks in `zone` show the given time. */
function zoned(zone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (time: number) => {
    const p = partsIn(zone, new Date(time));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - time;
  };
  // Second pass for times right after a daylight saving switch
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess));
}

/** "Montag, 5. Oktober 2026, 10:42 Uhr" */
export function describeNow(zone: string, now: Date): string {
  const text = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return `${text.replace(' um ', ', ')} Uhr`;
}

/** "2026-10-05": today's date for the model to count from */
export function isoDate(zone: string, now: Date): string {
  const p = partsIn(zone, now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "5.10., 10:42 Uhr" */
export function shortDateTime(zone: string, date: Date): string {
  const p = partsIn(zone, date);
  return `${p.day}.${p.month}., ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} Uhr`;
}

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];

/** How somebody names a day on the phone, taken apart by the model but not yet turned into a date. */
export interface SpokenDay {
  /** "heute", "morgen", "uebermorgen", a weekday, "+14" (days from today) or "2026-11-03" */
  day: string;
  /** For weekdays: this, next or the week after next; without it the next such day */
  week?: 'diese' | 'naechste' | 'uebernaechste';
  /** "14:30"; 9:00 without */
  time?: string;
}

/**
 * The moment a spoken day means for somebody in `zone`. The model only
 * names the weekday and the week, the counting happens here: asked for the
 * date of "Thursday next week" it is off by days more often than not.
 * null if `day` is not one of the forms above.
 */
export function resolveDay(zone: string, now: Date, spoken: SpokenDay): Date | null {
  const today = partsIn(zone, now);
  const day = spoken.day.trim().toLowerCase();
  const clock = /^(\d{1,2})[:.](\d{2})/.exec(spoken.time?.trim() ?? '');
  const hour = clock && Number(clock[1]) <= 23 ? Number(clock[1]) : 9;
  const minute = clock && Number(clock[1]) <= 23 && Number(clock[2]) <= 59 ? Number(clock[2]) : 0;

  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (date) {
    const [year, month, dayOfMonth] = [Number(date[1]), Number(date[2]), Number(date[3])];
    if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
    return zoned(zone, year, month, dayOfMonth, hour, minute);
  }

  let ahead: number;
  const weekday = WEEKDAYS.indexOf(day);
  if (day === 'heute') ahead = 0;
  else if (day === 'morgen') ahead = 1;
  else if (day === 'uebermorgen') ahead = 2;
  else if (/^\+\d{1,3}$/.test(day)) ahead = Number(day);
  else if (weekday >= 0) {
    // Weeks run from Monday to Sunday
    const inThisWeek = ((weekday + 6) % 7) - ((today.weekday + 6) % 7);
    if (spoken.week === 'naechste') ahead = inThisWeek + 7;
    else if (spoken.week === 'uebernaechste') ahead = inThisWeek + 14;
    // "Am Freitag" on a Friday, or a day of this week that is over: the next one
    else ahead = inThisWeek > 0 ? inThisWeek : inThisWeek + 7;
  } else return null;

  // Noon keeps the date stable across daylight saving switches
  const target = partsIn(zone, new Date(zoned(zone, today.year, today.month, today.day, 12, 0).getTime() + ahead * 86_400_000));
  return zoned(zone, target.year, target.month, target.day, hour, minute);
}

/** "Donnerstag, 15.10., 09:00 Uhr" */
export function spokenDateTime(zone: string, date: Date): string {
  const p = partsIn(zone, date);
  const name = WEEKDAYS[p.weekday];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${shortDateTime(zone, date)}`;
}

/** Saturday and Sunday move to the Friday before, same time: "by the end of the month" is a working day. */
export function onWorkday(zone: string, date: Date): Date {
  const p = partsIn(zone, date);
  const back = p.weekday === 6 ? 1 : p.weekday === 0 ? 2 : 0;
  if (!back) return date;
  const friday = partsIn(zone, new Date(zoned(zone, p.year, p.month, p.day, 12, 0).getTime() - back * 86_400_000));
  return zoned(zone, friday.year, friday.month, friday.day, p.hour, p.minute);
}

/** Mon–Fri between 9 and 18 o'clock in `zone`. */
export function isOfficeTime(zone: string, date: Date): boolean {
  const p = partsIn(zone, date);
  return p.weekday >= 1 && p.weekday <= 5 && p.hour >= 9 && p.hour < 18;
}

/** A full hour within office hours (Mon–Fri, 9–17), at least an hour away. */
export function nextOfficeHour(zone: string, now: Date): Date {
  const start = partsIn(zone, new Date(now.getTime() + 90 * 60_000));
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    // Noon keeps the date stable across daylight saving switches
    const day = partsIn(zone, new Date(zoned(zone, start.year, start.month, start.day, 12, 0).getTime() + dayOffset * 86_400_000));
    if (day.weekday === 0 || day.weekday === 6) continue;
    const hour = dayOffset === 0 ? Math.max(start.hour, 9) : 9;
    if (hour <= 17) return zoned(zone, day.year, day.month, day.day, hour, 0);
  }
  return new Date(now.getTime() + 86_400_000);
}
