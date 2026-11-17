/**
 * Euro/dollar at the ECB reference rate (Frankfurter, no key).
 *
 * The ECB publishes once per business day around 16:00 Frankfurt time, i.e.
 * after the New York open, so each morning starts with yesterday's rate and
 * the day's rate replaces it once out. Each point is converted with the rate
 * of its own (New York) day, or the last known one on weekends and holidays;
 * the headline figure uses the latest rate.
 */
import type { FetchFn } from "./env";
import { parseFxSeries } from "./schemas";
import { kvPut } from "./store";
import { addDays } from "./time";

export const FRANKFURTER = "https://api.frankfurter.dev/v1/";
const RETRY_MS = 30 * 60 * 1000;
const BACKFILL_DAYS = 10;

export interface FxRate {
  readonly date: string;
  readonly eurPerUsd: number;
}

export async function latestRate(db: D1Database): Promise<FxRate | null> {
  const row = await db.prepare("SELECT date, eur_per_usd FROM fx_rates ORDER BY date DESC LIMIT 1").first<{ date: string; eur_per_usd: number }>();
  return row ? { date: row.date, eurPerUsd: row.eur_per_usd } : null;
}

export async function allRates(db: D1Database, fromDate?: string): Promise<FxRate[]> {
  // Include the last rate before fromDate, so the first day of a range has one.
  const res = fromDate
    ? await db
        .prepare("SELECT date, eur_per_usd FROM fx_rates WHERE date >= (SELECT COALESCE(MAX(date), '') FROM fx_rates WHERE date <= ?) ORDER BY date")
        .bind(fromDate)
        .all<{ date: string; eur_per_usd: number }>()
    : await db.prepare("SELECT date, eur_per_usd FROM fx_rates ORDER BY date").all<{ date: string; eur_per_usd: number }>();
  return res.results.map((r) => ({ date: r.date, eurPerUsd: r.eur_per_usd }));
}

/**
 * Rate for a day: the latest published on or before it. Before the first
 * known rate, the earliest one (only possible for points older than day 0's
 * rate, which should not exist). `rates` must be sorted by date.
 */
export function rateFor(rates: readonly FxRate[], date: string): number | null {
  if (rates.length === 0) return null;
  let lo = 0;
  let hi = rates.length - 1;
  if (date < (rates[0] as FxRate).date) return (rates[0] as FxRate).eurPerUsd;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((rates[mid] as FxRate).date <= date) lo = mid;
    else hi = mid - 1;
  }
  return (rates[lo] as FxRate).eurPerUsd;
}

/**
 * Fetch missing rates if today's is not stored yet, at most every 30 minutes.
 * One subrequest, open-ended range so a gap (weekend, outage) fills itself.
 * Returns statements to batch, or [] when nothing to do.
 */
export async function refreshRates(
  db: D1Database,
  fetchFn: FetchFn,
  today: string,
  now: number,
  latest: FxRate | null,
  lastTry: number | null,
): Promise<{ statements: D1PreparedStatement[]; fetched: boolean; rates: FxRate[] }> {
  if (latest && latest.date >= today) return { statements: [], fetched: false, rates: [] };
  if (lastTry !== null && now - lastTry < RETRY_MS) return { statements: [], fetched: false, rates: [] };

  const statements: D1PreparedStatement[] = [kvPut(db, "fx_last_try", now, now)];
  const start = latest ? addDays(latest.date, 1) : addDays(today, -BACKFILL_DAYS);
  const url = FRANKFURTER + start + "..?base=USD&symbols=EUR";
  const res = await fetchFn(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  // 404: the range starts after the last published rate (nothing new yet).
  if (res.status === 404) return { statements, fetched: true, rates: [] };
  // Workers only support "follow" and "manual": a redirect is refused here.
  if (!res.ok) throw new Error("frankfurter: HTTP " + res.status);
  const parsed = parseFxSeries(await res.json());
  const rates: FxRate[] = [];
  for (const { date, eur } of parsed) {
    rates.push({ date, eurPerUsd: eur });
    statements.push(
      db.prepare("INSERT INTO fx_rates (date, eur_per_usd, fetched_at) VALUES (?, ?, ?) ON CONFLICT(date) DO NOTHING").bind(date, eur, now),
    );
  }
  rates.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { statements, fetched: true, rates };
}
