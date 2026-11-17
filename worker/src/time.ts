/**
 * Time zones without Intl. Creating an Intl.DateTimeFormat with a time zone
 * costs tens of milliseconds of CPU on a cold isolate, more than the whole
 * 10 ms budget of a free cron. The two zones Pile needs follow fixed rules:
 *
 * - New York: UTC-5, daylight time UTC-4 from the second Sunday of March at
 *   2:00 local (7:00 UTC) to the first Sunday of November at 2:00 local
 *   (6:00 UTC). US rule since 2007.
 * - Paris: UTC+1, summer time UTC+2 from the last Sunday of March to the last
 *   Sunday of October, both at 1:00 UTC. EU rule since 1996.
 *
 * Nothing is hard-coded per year, so the weeks when Paris and New York are
 * 5 hours apart come out right. Tests compare this with Intl hour by hour.
 */

export const NY = "America/New_York";
export const PARIS = "Europe/Paris";
export type Zone = typeof NY | typeof PARIS;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** UTC ms of the n-th Sunday (n >= 1) of a month, or the last one (n = -1), at a UTC hour. */
function sunday(year: number, month: number, n: number, utcHour: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const day = 1 + ((7 - first) % 7) + (n - 1) * 7;
    return Date.UTC(year, month, day, utcHour);
  }
  const lastDate = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDate.getUTCDate() - lastDate.getUTCDay(), utcHour);
}

/** Offset from UTC in hours at an instant. */
export function offsetHours(ms: number, tz: Zone): number {
  const year = new Date(ms).getUTCFullYear();
  if (tz === NY) {
    return ms >= sunday(year, 2, 2, 7) && ms < sunday(year, 10, 1, 6) ? -4 : -5;
  }
  return ms >= sunday(year, 2, -1, 1) && ms < sunday(year, 9, -1, 1) ? 2 : 1;
}

export interface ZonedParts {
  /** YYYY-MM-DD in that zone */
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** minutes since local midnight */
  readonly minutes: number;
  /** 0 = Sunday … 6 = Saturday */
  readonly weekday: number;
}

export function zoned(ms: number, tz: Zone): ZonedParts {
  const local = new Date(ms + offsetHours(ms, tz) * HOUR);
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  return {
    date: local.toISOString().slice(0, 10),
    hour,
    minute,
    second: local.getUTCSeconds(),
    minutes: hour * 60 + minute,
    weekday: local.getUTCDay(),
  };
}

/** UTC milliseconds of a wall-clock time (YYYY-MM-DD, HH:MM) in a zone. */
export function zonedToUtc(date: string, hhmm: string, tz: Zone): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Try the standard offset, then correct once if daylight time applies.
  let ms = wall - offsetHours(wall, tz) * HOUR;
  ms = wall - offsetHours(ms, tz) * HOUR;
  return ms;
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** The watcher's daily window in New York: 9:25 to 16:10, Monday to Friday. */
export const WINDOW_START = 9 * 60 + 25;
export const WINDOW_END = 16 * 60 + 10;

export function inWatchWindow(ms: number): boolean {
  const p = zoned(ms, NY);
  return p.weekday >= 1 && p.weekday <= 5 && p.minutes >= WINDOW_START && p.minutes <= WINDOW_END;
}

/** Floor to the minute. */
export function minuteOf(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}
