/**
 * The watcher's minute (milestone 2: read only, no order is ever sent).
 *
 * 1. Outside 9:25–16:10 New York on weekdays: return at once (no I/O at all).
 * 2. Clock from cache (Alpaca only at boundaries). Market closed: stop.
 * 3. GET /v2/account, then the paper guard. Refused: alert, record nothing.
 * 4. ECB rate if today's is missing (at most every 30 min).
 * 5. Positions snapshot, SPY 1-minute bars, equity point, SPY point, day 0.
 * All writes go to D1 in one batch at the end.
 */
import { AlpacaError, PaperLockError, trading, type AlpacaKeys, type Fetcher } from "./alpaca";
import { getClock, type CachedClock } from "./clock";
import { fetchSkillPopularity } from "./crowd";
import type { Deps, Env, FetchFn } from "./env";
import { refreshRates, type FxRate } from "./fx";
import { checkAccount } from "./guard";
import { fetchBars, latestClose, resumeStart, saveBars } from "./market";
import { parsePositions } from "./schemas";
import { alert, configPut, kvPut } from "./store";
import { NY, inWatchWindow, minuteOf, zoned, zonedToUtc } from "./time";

export const BASE_EUR = 50;
export const BENCHMARK = "SPY";
const RETENTION_FULL_MS = 30 * 24 * 3600 * 1000;
const RETENTION_BARS_MS = 90 * 24 * 3600 * 1000;
const COMPACT_BUCKET_MS = 15 * 60 * 1000;

export interface Day0 {
  readonly date: string;
  readonly ts: number;
  readonly accountId: string;
  readonly equityUsd: number;
  readonly fxDate: string;
  readonly eurPerUsd: number;
  readonly baseEur: number;
  readonly spyPrice: number;
  /** Day 0's 50 euros, in dollars at day 0's rate, held in SPY. */
  readonly spyShares: number;
}

export interface PositionSnapshot {
  readonly at: number;
  readonly items: readonly {
    readonly symbol: string;
    readonly qty: number;
    readonly avgEntryPrice: number;
    readonly currentPrice: number;
    readonly marketValue: number;
    readonly unrealizedPl: number;
  }[];
}

export type TickStatus = "outside_window" | "no_keys" | "market_closed" | "guard_refused" | "recorded" | "error";

export interface TickReport {
  readonly status: TickStatus;
  readonly subrequests: number;
  readonly detail?: string;
}

interface Health {
  readonly ok: boolean;
  readonly at: number;
  readonly code?: string;
}

/** Everything a minute reads from D1, in one round trip. */
interface Preload {
  readonly clock: CachedClock | null;
  readonly fxLastTry: number | null;
  readonly compacted: string | null;
  readonly day0: Day0 | null;
  readonly latestRate: FxRate | null;
  readonly lastSpy: { price: number; ts: number } | null;
  readonly crowdFetched: string | null;
  /** Passes reported today, and whether any pass was ever reported (the schedule is live). */
  readonly passesToday: readonly string[];
  readonly passesLive: boolean;
}

async function preload(db: D1Database, sessionStart: number, today: string): Promise<Preload> {
  const [kv, cfg, fx, bar, passes, live] = await db.batch([
    db.prepare("SELECT key, value FROM kv_state WHERE key IN ('clock', 'fx_last_try', 'compacted', 'crowd_fetched')"),
    db.prepare("SELECT value FROM config WHERE key = 'day0'"),
    db.prepare("SELECT date, eur_per_usd FROM fx_rates ORDER BY date DESC LIMIT 1"),
    db.prepare("SELECT ts, c FROM bars_1m WHERE symbol = ? AND ts >= ? ORDER BY ts DESC LIMIT 1").bind(BENCHMARK, sessionStart),
    db.prepare("SELECT DISTINCT pass FROM passes WHERE date = ?").bind(today),
    db.prepare("SELECT EXISTS (SELECT 1 FROM passes) AS live"),
  ]);
  const map = new Map<string, unknown>();
  for (const r of (kv?.results ?? []) as { key: string; value: string }[]) map.set(r.key, JSON.parse(r.value));
  const c = (cfg?.results?.[0] as { value: string } | undefined)?.value;
  const f = fx?.results?.[0] as { date: string; eur_per_usd: number } | undefined;
  const b = bar?.results?.[0] as { ts: number; c: number } | undefined;
  return {
    clock: (map.get("clock") as CachedClock | undefined) ?? null,
    fxLastTry: (map.get("fx_last_try") as number | undefined) ?? null,
    compacted: (map.get("compacted") as string | undefined) ?? null,
    day0: c ? (JSON.parse(c) as Day0) : null,
    latestRate: f ? { date: f.date, eurPerUsd: f.eur_per_usd } : null,
    lastSpy: b ? { price: b.c, ts: b.ts } : null,
    crowdFetched: (map.get("crowd_fetched") as string | undefined) ?? null,
    passesToday: ((passes?.results ?? []) as { pass: string }[]).map((r) => r.pass),
    passesLive: ((live?.results?.[0] as { live: number } | undefined)?.live ?? 0) === 1,
  };
}

function keysOf(env: Env): AlpacaKeys | null {
  return env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY ? { keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY } : null;
}

export async function tick(env: Env, scheduledTime: number, deps: Deps): Promise<TickReport> {
  const now = scheduledTime;
  if (!inWatchWindow(now)) return { status: "outside_window", subrequests: 0 };

  const db = env.DB;
  const ny = zoned(now, NY);
  let subrequests = 0;
  const fetcher: Fetcher = (input, init) => {
    subrequests++;
    return deps.fetch(input, init);
  };
  const fetchFn = (input: URL | string, init?: RequestInit) => {
    subrequests++;
    return deps.fetch(input, init);
  };
  const statements: D1PreparedStatement[] = [kvPut(db, "last_tick", { at: now }, now)];
  const finish = async (status: TickStatus, detail?: string): Promise<TickReport> => {
    try {
      await db.batch(statements);
    } catch (e) {
      // The batch is atomic: one bad statement loses the whole minute. Keep
      // at least the heartbeat and the reason, so a failure is never silent.
      await recordFailure(db, now, ny.date, "batch_failed", e);
      return { status: "error", subrequests, detail: "batch_failed" };
    }
    return detail === undefined ? { status, subrequests } : { status, subrequests, detail };
  };

  const keys = keysOf(env);
  if (!keys) {
    statements.push(alert(db, now, "critical", "veilleur", "keys_missing", "Clés Alpaca paper absentes des secrets du Worker.", "keys_missing:" + ny.date));
    return finish("no_keys");
  }

  try {
    const sessionStart = zonedToUtc(ny.date, "09:30", NY);
    const pre = await preload(db, sessionStart, ny.date);
    const { clock, save } = await getClock(db, fetcher, keys, now, pre.clock);
    if (save) statements.push(save);
    if (save && clock.isOpen) statements.push(kvPut(db, "last_open_date", ny.date, now));
    await dailyCrowd(db, fetchFn, now, ny.date, pre.crowdFetched, statements);
    if (clock.isOpen && pre.passesLive) missingPasses(db, now, ny.date, ny.minutes, pre.passesToday, statements);
    if (!clock.isOpen) {
      compactOnceADay(db, now, ny.date, ny.minutes, pre.compacted, statements);
      return finish("market_closed");
    }

    // Paper guard, every minute, before anything else touches the account.
    const account = await trading(fetcher, keys, "GET", "/v2/account");
    const day0 = pre.day0;
    const verdict = checkAccount(account, day0?.accountId ?? null);
    statements.push(kvPut(db, "health_alpaca", verdict.ok ? { ok: true, at: now } : { ok: false, at: now, code: verdict.code }, now));
    if (!verdict.ok) {
      statements.push(
        alert(db, now, "critical", "veilleur", "guard_" + verdict.code, "Compte refusé (" + verdict.accountTag + ") : " + verdict.message + ". Rien n'est enregistré ni exécuté.", "guard:" + verdict.code + ":" + ny.date),
      );
      return finish("guard_refused", verdict.code);
    }

    // ECB rate (non-blocking: yesterday's rate keeps working).
    let freshRate: FxRate | null = null;
    try {
      const fx = await refreshRates(db, fetchFn, ny.date, now, pre.latestRate, pre.fxLastTry);
      statements.push(...fx.statements);
      freshRate = fx.rates.length ? (fx.rates[fx.rates.length - 1] as FxRate) : null;
      if (fx.fetched) statements.push(kvPut(db, "health_fx", { ok: true, at: now } satisfies Health, now));
    } catch (e) {
      statements.push(kvPut(db, "health_fx", { ok: false, at: now, code: "fx_unavailable" } satisfies Health, now));
      statements.push(alert(db, now, "warn", "veilleur", "fx_unavailable", "Taux BCE indisponible : dernier taux connu utilisé. " + errorText(e), "fx:" + ny.date));
    }

    const positions = parsePositions(await trading(fetcher, keys, "GET", "/v2/positions"));
    const snapshot: PositionSnapshot = {
      at: now,
      items: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avgEntryPrice: p.avg_entry_price,
        currentPrice: p.current_price,
        marketValue: p.market_value,
        unrealizedPl: p.unrealized_pl,
      })),
    };
    statements.push(kvPut(db, "positions", snapshot, now));

    // Benchmark bars (milestone 5 adds the armed symbols to the same request).
    const symbols = [BENCHMARK];
    const start = resumeStart(pre.lastSpy?.ts ?? null, now, sessionStart);
    const bars = start < minuteOf(now) ? await fetchBars(fetcher, keys, symbols, start) : [];
    statements.push(...saveBars(db, bars));
    statements.push(kvPut(db, "health_data", { ok: true, at: now } satisfies Health, now));
    const spy = latestClose(BENCHMARK, bars, pre.lastSpy);

    const minute = minuteOf(now);
    const a = account as Record<string, unknown>;
    const cash = Number(a["cash"]);
    statements.push(
      db
        .prepare("INSERT INTO equity_points (ts, equity_usd, cash_usd) VALUES (?, ?, ?) ON CONFLICT(ts) DO UPDATE SET equity_usd = excluded.equity_usd, cash_usd = excluded.cash_usd")
        .bind(minute, verdict.equityUsd, Number.isFinite(cash) ? cash : null),
    );

    // Day 0: the first recorded minute with a rate and a SPY price.
    let effectiveDay0 = day0;
    if (!effectiveDay0) {
      // The rate just fetched is not in D1 yet (one batch at the end): take the newer of the two.
      const stored = pre.latestRate;
      const rate = freshRate && (!stored || freshRate.date > stored.date) ? freshRate : stored;
      if (rate && spy) {
        effectiveDay0 = {
          date: ny.date,
          ts: minute,
          accountId: (a["id"] as string),
          equityUsd: verdict.equityUsd,
          fxDate: rate.date,
          eurPerUsd: rate.eurPerUsd,
          baseEur: BASE_EUR,
          spyPrice: spy.price,
          spyShares: BASE_EUR / rate.eurPerUsd / spy.price,
        };
        statements.push(configPut(db, "day0", effectiveDay0, now));
        statements.push(
          alert(db, now, "info", "veilleur", "day0", "Jour 0 enregistré : " + verdict.equityUsd.toFixed(2) + " $, taux BCE " + rate.eurPerUsd + " (" + rate.date + "), base 50 €.", "day0"),
        );
      }
    }
    if (effectiveDay0 && spy) {
      statements.push(
        db
          .prepare("INSERT INTO spy_points (ts, price, value_usd) VALUES (?, ?, ?) ON CONFLICT(ts) DO UPDATE SET price = excluded.price, value_usd = excluded.value_usd")
          .bind(minute, spy.price, effectiveDay0.spyShares * spy.price),
      );
    }

    return finish("recorded");
  } catch (e) {
    const auth = e instanceof AlpacaError && (e.status === 401 || e.status === 403);
    const lock = e instanceof PaperLockError;
    const code = lock ? "paper_lock" : auth ? "alpaca_auth" : "tick_error";
    statements.push(kvPut(db, "health_alpaca", { ok: false, at: now, code } satisfies Health, now));
    statements.push(
      alert(db, now, lock || auth ? "critical" : "warn", "veilleur", code, errorText(e), code + ":" + ny.date + ":" + (lock || auth ? "" : ny.hour)),
    );
    return finish("error", code);
  }
}

/** Once a day: the skill's GitHub stars and forks (crowd index). Never blocks the minute. */
async function dailyCrowd(db: D1Database, fetchFn: FetchFn, now: number, date: string, done: string | null, statements: D1PreparedStatement[]): Promise<void> {
  if (done === date) return;
  statements.push(kvPut(db, "crowd_fetched", date, now));
  try {
    const { stars, forks } = await fetchSkillPopularity(fetchFn);
    statements.push(
      db.prepare("INSERT INTO crowd_daily (date, stars, forks, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET stars = excluded.stars, forks = excluded.forks, fetched_at = excluded.fetched_at").bind(date, stars, forks, now),
    );
  } catch (e) {
    statements.push(alert(db, now, "info", "veilleur", "crowd_github", "Popularité du skill illisible aujourd'hui : " + errorText(e), "crowd_github:" + date));
  }
}

/** Passes the watcher can see from its window (9:25–16:10 NY): alert 20 min after a pass that did not report. */
const WATCHED_PASSES = [
  { name: "avant-ouverture", due: 9 * 60 + 35 },
  { name: "cassures", due: 10 * 60 + 7 },
  { name: "mi-seance", due: 12 * 60 + 20 },
] as const;

function missingPasses(db: D1Database, now: number, date: string, minutes: number, seen: readonly string[], statements: D1PreparedStatement[]): void {
  for (const p of WATCHED_PASSES) {
    if (minutes >= p.due && !seen.includes(p.name)) {
      statements.push(alert(db, now, "critical", "veilleur", "pass_missing", "Le passage « " + p.name + " » de Claude n'a pas donné signe de vie : aucun plan nouveau ne viendra de lui.", "pass_missing:" + p.name + ":" + date));
    }
  }
}

/** Last-resort record of a failed minute: heartbeat with the reason, and one alert per hour. */
export async function recordFailure(db: D1Database, now: number, nyDate: string, code: string, e: unknown): Promise<void> {
  const text = errorText(e).slice(0, 300);
  try {
    await db.batch([
      kvPut(db, "last_tick", { at: now, error: code, message: text }, now),
      alert(db, now, "critical", "veilleur", code, "Minute non enregistrée : " + text, code + ":" + nyDate + ":" + zoned(now, NY).hour),
    ]);
  } catch (inner) {
    console.error(JSON.stringify({ tick_record_failure: errorText(inner), original: text }));
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.name + ": " + e.message : "erreur inconnue";
}

/** After 16:00 New York, once a day: 1-minute points older than 30 days become 15-minute points; bars older than 90 days go. */
function compactOnceADay(db: D1Database, now: number, date: string, minutes: number, done: string | null, statements: D1PreparedStatement[]): void {
  if (minutes < 16 * 60) return;
  if (done === date) return;
  const cutoff = now - RETENTION_FULL_MS;
  for (const table of ["equity_points", "spy_points"]) {
    statements.push(
      db
        .prepare("DELETE FROM " + table + " WHERE ts < ?1 AND ts NOT IN (SELECT MAX(ts) FROM " + table + " WHERE ts < ?1 GROUP BY ts / CAST(?2 AS INTEGER))")
        .bind(cutoff, COMPACT_BUCKET_MS),
    );
  }
  statements.push(db.prepare("DELETE FROM bars_1m WHERE ts < ?").bind(now - RETENTION_BARS_MS));
  statements.push(kvPut(db, "compacted", date, now));
}
