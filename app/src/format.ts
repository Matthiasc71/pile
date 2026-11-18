/** French formatting. Paris time always comes from Intl, never a fixed offset. */

const NBSP = "\u00a0";
const NNBSP = "\u202f";
const MINUS = "−";

const num2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function sign(v: number, always: boolean): string {
  if (v < 0) return MINUS;
  return always && v > 0 ? "+" : "";
}

/** 51,32 € — or +1,32 € / −0,49 € with signed. Rounds before choosing the sign (no "−0,00 €"). */
export function eur(v: number, signed = false, digits = 2): string {
  const f = digits === 2 ? num2 : num1;
  const r = Math.round(Math.abs(v) * 10 ** digits) / 10 ** digits;
  return sign(r === 0 ? 0 : v, signed) + f.format(r).replace(/\u202f|\u00a0/g, NNBSP) + NBSP + "€";
}

export function usd(v: number, signed = false): string {
  const r = Math.round(Math.abs(v) * 100) / 100;
  return sign(r === 0 ? 0 : v, signed) + num2.format(r).replace(/\u202f|\u00a0/g, NNBSP) + NBSP + "$";
}

/** +2,6 % */
export function pct(v: number, signed = true): string {
  const r = Math.round(Math.abs(v) * 10) / 10;
  return sign(r === 0 ? 0 : v, signed) + num1.format(r) + NBSP + "%";
}

const parisTime = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const parisDay = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short" });
const parisWeekday = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short" });
const parisDate = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** 17:42 */
export function hhmm(ms: number): string {
  return parisTime.format(ms);
}

/** "mar. 17 nov." */
export function day(ms: number): string {
  return parisDay.format(ms);
}

/** "17:42" today, "lun. 16:40" another day (like the mockup's history). */
export function when(ms: number, now: number): string {
  if (parisDate.format(ms) === parisDate.format(now)) return hhmm(ms);
  return parisWeekday.format(ms) + " " + hhmm(ms);
}

/** "il y a 40 s", "il y a 3 min", "il y a 2 h", or a date. */
export function ago(ms: number | null | undefined, now: number): string {
  if (!ms) return "jamais";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "il y a " + s + NBSP + "s";
  const m = Math.round(s / 60);
  if (m < 60) return "il y a " + m + NBSP + "min";
  const h = Math.round(m / 60);
  if (h < 24) return "il y a " + h + NBSP + "h";
  return day(ms) + " " + hhmm(ms);
}

/** "0,10 €/div" */
export function perDiv(v: number): string {
  const digits = v < 0.1 ? 3 : 2;
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v) + NBSP + "€/div";
}
