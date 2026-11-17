/**
 * IEX 1-minute bars from Alpaca Market Data, one multi-symbol request per
 * minute. Bars are stored in bars_1m as fetched (for the replay mode).
 * IEX volume is only part of total volume: any volume comparison must be IEX
 * against IEX.
 */
import { marketData, type AlpacaKeys, type Fetcher } from "./alpaca";
import { BarsResponseSchema, type AlpacaBar } from "./schemas";

const MAX_PAGES = 2;
const LOOKBACK_MS = 30 * 60 * 1000;

export interface Bar {
  readonly symbol: string;
  readonly ts: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
  readonly n: number | null;
  readonly vw: number | null;
}

function toBar(symbol: string, b: AlpacaBar): Bar {
  return { symbol, ts: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: Math.round(b.v), n: b.n ?? null, vw: b.vw ?? null };
}

/** Where to resume: one minute after the last stored bar, never before sessionStart or more than 30 min back. */
export async function resumeFrom(db: D1Database, symbols: readonly string[], now: number, sessionStart: number): Promise<number> {
  const placeholders = symbols.map(() => "?").join(",");
  const row = await db
    .prepare("SELECT MIN(last_ts) AS ts FROM (SELECT MAX(ts) AS last_ts FROM bars_1m WHERE symbol IN (" + placeholders + ") AND ts >= ? GROUP BY symbol)")
    .bind(...symbols, sessionStart)
    .first<{ ts: number | null }>();
  const floor = Math.max(sessionStart, now - LOOKBACK_MS);
  return row?.ts ? Math.max(row.ts + 60_000, floor) : floor;
}

export async function fetchBars(fetcher: Fetcher, keys: AlpacaKeys, symbols: readonly string[], start: number): Promise<Bar[]> {
  const out: Bar[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: "1Min",
      start: new Date(start).toISOString(),
      feed: "iex",
      adjustment: "raw",
      limit: "1000",
    });
    if (pageToken) q.set("page_token", pageToken);
    const parsed = BarsResponseSchema.parse(await marketData(fetcher, keys, "/v2/stocks/bars?" + q.toString()));
    for (const [symbol, bars] of Object.entries(parsed.bars ?? {})) {
      for (const b of bars) out.push(toBar(symbol, b));
    }
    pageToken = parsed.next_page_token ?? null;
    if (!pageToken) break;
  }
  return out;
}

export function saveBars(db: D1Database, bars: readonly Bar[]): D1PreparedStatement[] {
  const stmt = db.prepare(
    "INSERT INTO bars_1m (symbol, ts, o, h, l, c, v, n, vw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, ts) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v, n=excluded.n, vw=excluded.vw",
  );
  return bars.map((b) => stmt.bind(b.symbol, b.ts, b.o, b.h, b.l, b.c, b.v, b.n, b.vw));
}

/** Latest close per symbol: from the new bars, else from storage. */
export async function latestClose(db: D1Database, symbol: string, fresh: readonly Bar[]): Promise<{ price: number; ts: number } | null> {
  let best: Bar | null = null;
  for (const b of fresh) if (b.symbol === symbol && (!best || b.ts > best.ts)) best = b;
  if (best) return { price: best.c, ts: best.ts };
  const row = await db.prepare("SELECT c, ts FROM bars_1m WHERE symbol = ? ORDER BY ts DESC LIMIT 1").bind(symbol).first<{ c: number; ts: number }>();
  return row ? { price: row.c, ts: row.ts } : null;
}
