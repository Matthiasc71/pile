/**
 * Alpaca's market clock, cached in D1. Holidays and 1 p.m. early closes come
 * from Alpaca itself; we only refetch when a boundary passes (open or close)
 * or the cache is stale, so a normal minute costs no subrequest.
 */
import { trading, type AlpacaKeys, type Fetcher } from "./alpaca";
import { parseClock } from "./schemas";
import { kvGet, kvPut } from "./store";

export interface CachedClock {
  readonly isOpen: boolean;
  readonly nextOpen: number;
  readonly nextClose: number;
  readonly fetchedAt: number;
}

const KEY = "clock";
const STALE_MS = 6 * 60 * 60 * 1000;

export function clockNeedsRefresh(c: CachedClock | null, now: number): boolean {
  if (!c) return true;
  if (now - c.fetchedAt > STALE_MS) return true;
  return c.isOpen ? now >= c.nextClose : now >= c.nextOpen;
}

/** The clock, from cache or from Alpaca. Returns the statement to persist a refresh (batched by the caller). */
export async function getClock(db: D1Database, fetcher: Fetcher, keys: AlpacaKeys, now: number, cached: CachedClock | null): Promise<{ clock: CachedClock; save: D1PreparedStatement | null }> {
  if (cached && !clockNeedsRefresh(cached, now)) return { clock: cached, save: null };
  const raw = parseClock(await trading(fetcher, keys, "GET", "/v2/clock"));
  const clock: CachedClock = {
    isOpen: raw.is_open,
    nextOpen: Date.parse(raw.next_open),
    nextClose: Date.parse(raw.next_close),
    fetchedAt: now,
  };
  if (!Number.isFinite(clock.nextOpen) || !Number.isFinite(clock.nextClose)) {
    throw new Error("clock: unreadable next_open/next_close");
  }
  return { clock, save: kvPut(db, KEY, clock, now) };
}

export async function readClock(db: D1Database): Promise<CachedClock | null> {
  return kvGet<CachedClock>(db, KEY);
}
