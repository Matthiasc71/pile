/**
 * Time zones without dependencies. New York for the market, Paris for display,
 * computed with Intl so daylight saving changes (including the weeks when
 * Paris and New York are 5 hours apart) are never hard-coded.
 */

export const NY = "America/New_York";
export const PARIS = "Europe/Paris";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
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

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zoned(ms: number, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hour = Number(parts["hour"]);
  const minute = Number(parts["minute"]);
  return {
    date: parts["year"] + "-" + parts["month"] + "-" + parts["day"],
    hour,
    minute,
    second: Number(parts["second"]),
    minutes: hour * 60 + minute,
    weekday: WEEKDAYS[parts["weekday"] ?? ""] ?? -1,
  };
}

/** UTC milliseconds of a wall-clock time (YYYY-MM-DD, HH:MM) in a zone. */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset, including across a DST change.
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = zoned(ms, tz);
    const asUtc = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour, p.minute);
    ms += guess - asUtc;
  }
  return ms;
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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
