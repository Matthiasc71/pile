/** GET /api/state: everything the dashboard needs, from D1 only (no Alpaca call). */
import { plansOf } from "./brain";
import { readClock, type CachedClock } from "./clock";
import { latestRate } from "./fx";
import { configGet, kvGet } from "./store";
import { BASE_EUR, type Day0, type PositionSnapshot } from "./tick";
import { NY, zoned, zonedToUtc } from "./time";

/** Claude's four passes, New York time, on trading days. */
export const PASSES = [
  { name: "avant-ouverture", at: "09:15" },
  { name: "cassures", at: "09:47" },
  { name: "mi-seance", at: "12:00" },
  { name: "bilan", at: "16:15" },
] as const;

export interface Pause {
  readonly active: boolean;
  readonly reason: string | null;
  readonly since: number | null;
  readonly until: number | null;
}

export const NO_PAUSE: Pause = { active: false, reason: null, since: null, until: null };

export async function readPause(db: D1Database, now: number): Promise<Pause> {
  const p = await kvGet<Pause>(db, "pause");
  if (!p || !p.active) return NO_PAUSE;
  if (p.until !== null && now >= p.until) return NO_PAUSE;
  return p;
}

/**
 * The four passes of the relevant trading day: today while a pass is still
 * ahead (or the session is on), otherwise the next trading day.
 */
export function passDay(clock: CachedClock | null, lastOpenDate: string | null, now: number): { name: string; at: number }[] {
  if (!clock) return [];
  const today = zoned(now, NY).date;
  const nextOpenDate = zoned(clock.nextOpen, NY).date;
  const todayIsTrading = clock.isOpen || lastOpenDate === today || nextOpenDate === today;
  const list = (day: string) => PASSES.map((p) => ({ name: p.name, at: zonedToUtc(day, p.at, NY) }));
  if (todayIsTrading) {
    const todays = list(today);
    if (todays.some((p) => p.at > now)) return todays;
  }
  return nextOpenDate > today ? list(nextOpenDate) : [];
}

/** Next scheduled pass from the cached clock. Null before the first clock read. */
export function nextPass(clock: CachedClock | null, lastOpenDate: string | null, now: number): { name: string; at: number } | null {
  return passDay(clock, lastOpenDate, now).find((p) => p.at > now) ?? null;
}

/** The skill's recommended rules scaled to the account (section 5.3): 1 % per trade, 3 % per day, 3 trades. */
export function limitsFor(equityUsd: number): Record<string, number> {
  return {
    equity_usd: round(equityUsd, 2),
    max_loss_trade_usd: round(equityUsd * 0.01, 2),
    max_daily_loss_usd: round(equityUsd * 0.03, 2),
    max_trades: 3,
    max_position_usd: round(equityUsd * 0.75, 2),
    cash_buffer_usd: round(equityUsd * 0.1, 2),
  };
}

interface Health {
  readonly ok: boolean;
  readonly at: number;
  readonly code?: string;
}

export async function buildState(db: D1Database, now: number): Promise<unknown> {
  const today = zoned(now, NY).date;
  const [pause, clock, lastTick, lastOpenDate, day0, rate, equity, positions, alpaca, data, fx, claudePass, alertsOpen, plans, crowd, lastBilan] = await Promise.all([
    readPause(db, now),
    readClock(db),
    kvGet<{ at: number }>(db, "last_tick"),
    kvGet<string>(db, "last_open_date"),
    configGet<Day0>(db, "day0"),
    latestRate(db),
    db.prepare("SELECT ts, equity_usd, cash_usd FROM equity_points ORDER BY ts DESC LIMIT 1").first<{ ts: number; equity_usd: number; cash_usd: number | null }>(),
    kvGet<PositionSnapshot>(db, "positions"),
    kvGet<Health>(db, "health_alpaca"),
    kvGet<Health>(db, "health_data"),
    kvGet<Health>(db, "health_fx"),
    kvGet<{ at: number; pass: string }>(db, "last_claude_pass"),
    db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE acked_at IS NULL AND level != 'info'").first<{ n: number }>(),
    plansOf(db, today),
    db.prepare("SELECT date, stars, forks, score FROM crowd_daily WHERE score IS NOT NULL ORDER BY date DESC LIMIT 1").first<{ date: string; stars: number; forks: number; score: number }>(),
    db.prepare("SELECT date FROM journal WHERE kind = 'bilan' ORDER BY date DESC LIMIT 1").first<{ date: string }>(),
  ]);

  let money: unknown = null;
  if (equity && rate) {
    const eur = equity.equity_usd * rate.eurPerUsd;
    const delta = eur - BASE_EUR;
    money = {
      as_of: equity.ts,
      usd: round(equity.equity_usd, 2),
      cash_usd: equity.cash_usd === null ? null : round(equity.cash_usd, 2),
      eur: round(eur, 2),
      base_eur: BASE_EUR,
      delta_eur: round(delta, 2),
      delta_pct: round((delta / BASE_EUR) * 100, 1),
      fx: { eur_per_usd: rate.eurPerUsd, date: rate.date },
    };
  }

  return {
    now,
    paper: true,
    paused: pause,
    session: clock ? { open: clock.isOpen && now < clock.nextClose, next_open: clock.nextOpen, next_close: clock.nextClose } : null,
    money,
    day0: day0 ? { date: day0.date, usd: day0.equityUsd, eur_per_usd: day0.eurPerUsd, fx_date: day0.fxDate } : null,
    positions: positions?.items ?? [],
    positions_as_of: positions?.at ?? null,
    plans,
    today_is_trading: !!clock && (clock.isOpen || lastOpenDate === today || zoned(clock.nextOpen, NY).date === today),
    last_bilan_date: lastBilan?.date ?? null,
    limits: equity ? limitsFor(equity.equity_usd) : null,
    passes: passDay(clock, lastOpenDate, now),
    next_pass: nextPass(clock, lastOpenDate, now),
    crowd: crowd ? { score: crowd.score, date: crowd.date, stars: crowd.stars, forks: crowd.forks } : null,
    alerts_open: alertsOpen?.n ?? 0,
    health: {
      last_tick: lastTick?.at ?? null,
      last_claude_pass: claudePass ?? null,
      alpaca: alpaca ?? null,
      data: data ?? null,
      fx: fx ? { ...fx, rate_date: rate?.date ?? null } : rate ? { ok: true, at: null, rate_date: rate.date } : null,
    },
  };
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
