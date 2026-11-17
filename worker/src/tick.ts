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
import { getClock } from "./clock";
import type { Deps, Env } from "./env";
import { latestRate, refreshRates, type FxRate } from "./fx";
import { checkAccount } from "./guard";
import { fetchBars, latestClose, resumeFrom, saveBars } from "./market";
import { parsePositions } from "./schemas";
import { alert, configGet, configPut, kvGet, kvPut } from "./store";
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
    const { clock, save } = await getClock(db, fetcher, keys, now);
    if (save) statements.push(save);
    if (save && clock.isOpen) statements.push(kvPut(db, "last_open_date", ny.date, now));
    if (!clock.isOpen) {
      await compactOnceADay(db, now, ny.date, ny.minutes, statements);
      return finish("market_closed");
    }

    // Paper guard, every minute, before anything else touches the account.
    const account = await trading(fetcher, keys, "GET", "/v2/account");
    const day0 = await configGet<Day0>(db, "day0");
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
      const fx = await refreshRates(db, fetchFn, ny.date, now);
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
    const sessionStart = zonedToUtc(ny.date, "09:30", NY);
    const start = await resumeFrom(db, symbols, now, sessionStart);
    const bars = start < minuteOf(now) ? await fetchBars(fetcher, keys, symbols, start) : [];
    statements.push(...saveBars(db, bars));
    statements.push(kvPut(db, "health_data", { ok: true, at: now } satisfies Health, now));
    const spy = await latestClose(db, BENCHMARK, bars);

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
      const stored = await latestRate(db);
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
async function compactOnceADay(db: D1Database, now: number, date: string, minutes: number, statements: D1PreparedStatement[]): Promise<void> {
  if (minutes < 16 * 60) return;
  const done = await kvGet<string>(db, "compacted");
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
