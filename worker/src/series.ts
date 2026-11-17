/**
 * GET /api/series?range=1j|1s|1m|tout: the curves in euros.
 *
 * Each point is converted at the ECB rate of its own day (last known rate on
 * days without one). Points exist only between 9:25 and 16:10 New York, i.e.
 * 13:25–21:10 UTC, never across a New York midnight: a point's New York date
 * is therefore its UTC date, which keeps this handler cheap on CPU.
 * Bucketing happens in SQL (last point of each bucket).
 */
import { allRates, rateFor } from "./fx";
import { configGet } from "./store";
import { round } from "./state";
import { BASE_EUR, type Day0 } from "./tick";

export type Range = "1j" | "1s" | "1m" | "tout";
export const RANGES: readonly Range[] = ["1j", "1s", "1m", "tout"];

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MAX_POINTS = 400;

interface Row {
  readonly ts: number;
  readonly v: number;
}

async function bucketed(db: D1Database, table: "equity_points" | "spy_points", column: string, from: number, bucket: number): Promise<Row[]> {
  const sql =
    bucket <= MIN
      ? "SELECT ts, " + column + " AS v FROM " + table + " WHERE ts >= ?1 ORDER BY ts"
      : "SELECT ts, " + column + " AS v FROM " + table + " WHERE ts IN (SELECT MAX(ts) FROM " + table + " WHERE ts >= ?1 GROUP BY ts / CAST(?2 AS INTEGER)) ORDER BY ts";
  const res = await (bucket <= MIN ? db.prepare(sql).bind(from) : db.prepare(sql).bind(from, bucket)).all<Row>();
  return res.results;
}

export async function buildSeries(db: D1Database, range: Range, now: number): Promise<unknown> {
  const day0 = await configGet<Day0>(db, "day0");
  if (!day0) return { range, base_eur: BASE_EUR, points: [], markers: [], day0: null };

  let from: number;
  let bucket: number;
  if (range === "1j") {
    // The last session that has points (today, or the previous trading day).
    const last = await db.prepare("SELECT MAX(ts) AS ts FROM equity_points").first<{ ts: number | null }>();
    const lastTs = last?.ts ?? now;
    from = Math.floor(lastTs / DAY) * DAY;
    bucket = MIN;
  } else if (range === "1s") {
    from = now - 7 * DAY;
    bucket = 15 * MIN;
  } else if (range === "1m") {
    from = now - 31 * DAY;
    bucket = 60 * MIN;
  } else {
    from = day0.ts;
    const span = Math.max(now - day0.ts, MIN);
    bucket = Math.max(60 * MIN, Math.ceil(span / MAX_POINTS / MIN) * MIN);
  }
  from = Math.max(from, day0.ts);

  const [equity, spy, rates] = await Promise.all([
    bucketed(db, "equity_points", "equity_usd", from, bucket),
    bucketed(db, "spy_points", "value_usd", from, bucket),
    allRates(db, new Date(from).toISOString().slice(0, 10)),
  ]);

  const spyByBucket = new Map<number, number>();
  for (const r of spy) spyByBucket.set(Math.floor(r.ts / bucket), r.v);

  const points = [];
  for (const r of equity) {
    const rate = rateFor(rates, new Date(r.ts).toISOString().slice(0, 10));
    if (rate === null) continue;
    const s = spyByBucket.get(Math.floor(r.ts / bucket));
    points.push({
      t: r.ts,
      toi: round(r.v * rate, 4),
      sp: s === undefined ? null : round(s * rate, 4),
      fantome: null,
    });
  }

  return {
    range,
    base_eur: BASE_EUR,
    bucket_ms: bucket,
    points,
    markers: [],
    day0: { ts: day0.ts, date: day0.date },
    fx_latest: rates.length ? rates[rates.length - 1] : null,
  };
}
