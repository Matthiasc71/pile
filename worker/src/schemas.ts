/**
 * Shapes of what comes back from Alpaca and Frankfurter, checked by hand.
 * Anything unexpected throws, never guessed. No zod here on purpose: this runs
 * every minute in the cron, and building zod schemas on a cold isolate costs
 * several milliseconds of a 10 ms budget. zod stays for the API bodies.
 */

export class ShapeError extends Error {
  override readonly name = "ShapeError";
}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ShapeError(what + ": objet attendu");
  return v as Obj;
}
function str(o: Obj, k: string, what: string): string {
  const v = o[k];
  if (typeof v !== "string") throw new ShapeError(what + "." + k + ": texte attendu");
  return v;
}
function bool(o: Obj, k: string, what: string): boolean {
  const v = o[k];
  if (typeof v !== "boolean") throw new ShapeError(what + "." + k + ": booléen attendu");
  return v;
}
function finite(o: Obj, k: string, what: string): number {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new ShapeError(what + "." + k + ": nombre attendu");
}
/** Alpaca sends money as decimal strings ("55.07"). */
function decimal(o: Obj, k: string, what: string): number {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  throw new ShapeError(what + "." + k + ": montant attendu");
}
function optFinite(o: Obj, k: string, what: string): number | undefined {
  return o[k] === undefined || o[k] === null ? undefined : finite(o, k, what);
}

export interface AlpacaClock {
  readonly timestamp: string;
  readonly is_open: boolean;
  readonly next_open: string;
  readonly next_close: string;
}

export function parseClock(v: unknown): AlpacaClock {
  const o = obj(v, "clock");
  return { timestamp: str(o, "timestamp", "clock"), is_open: bool(o, "is_open", "clock"), next_open: str(o, "next_open", "clock"), next_close: str(o, "next_close", "clock") };
}

export interface AlpacaPosition {
  readonly symbol: string;
  readonly qty: number;
  readonly side: string;
  readonly avg_entry_price: number;
  readonly market_value: number;
  readonly current_price: number;
  readonly unrealized_pl: number;
  readonly unrealized_plpc: number;
}

export function parsePositions(v: unknown): AlpacaPosition[] {
  if (!Array.isArray(v)) throw new ShapeError("positions: liste attendue");
  return v.map((item, i) => {
    const w = "positions[" + i + "]";
    const o = obj(item, w);
    return {
      symbol: str(o, "symbol", w),
      qty: decimal(o, "qty", w),
      side: str(o, "side", w),
      avg_entry_price: decimal(o, "avg_entry_price", w),
      market_value: decimal(o, "market_value", w),
      current_price: decimal(o, "current_price", w),
      unrealized_pl: decimal(o, "unrealized_pl", w),
      unrealized_plpc: decimal(o, "unrealized_plpc", w),
    };
  });
}

export interface AlpacaBar {
  readonly t: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
  readonly n?: number;
  readonly vw?: number;
}

export interface BarsResponse {
  readonly bars: Record<string, AlpacaBar[]> | null;
  readonly next_page_token: string | null;
}

export function parseBars(v: unknown): BarsResponse {
  const o = obj(v, "bars");
  const raw = o["bars"];
  let bars: Record<string, AlpacaBar[]> | null = null;
  if (raw !== null && raw !== undefined) {
    bars = {};
    for (const [symbol, list] of Object.entries(obj(raw, "bars.bars"))) {
      if (!Array.isArray(list)) throw new ShapeError("bars." + symbol + ": liste attendue");
      bars[symbol] = list.map((b, i) => {
        const w = "bars." + symbol + "[" + i + "]";
        const x = obj(b, w);
        const bar: { -readonly [K in keyof AlpacaBar]: AlpacaBar[K] } = {
          t: str(x, "t", w),
          o: finite(x, "o", w),
          h: finite(x, "h", w),
          l: finite(x, "l", w),
          c: finite(x, "c", w),
          v: finite(x, "v", w),
        };
        const n = optFinite(x, "n", w);
        const vw = optFinite(x, "vw", w);
        if (n !== undefined) bar.n = n;
        if (vw !== undefined) bar.vw = vw;
        return bar;
      });
    }
  }
  const token = o["next_page_token"];
  if (token !== undefined && token !== null && typeof token !== "string") throw new ShapeError("bars.next_page_token: texte attendu");
  return { bars, next_page_token: typeof token === "string" ? token : null };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Frankfurter /v1/<start>..?base=USD&symbols=EUR → [{date, EUR}] */
export function parseFxSeries(v: unknown): { date: string; eur: number }[] {
  const o = obj(v, "fx");
  if (o["base"] !== "USD") throw new ShapeError("fx.base: USD attendu");
  const out: { date: string; eur: number }[] = [];
  for (const [date, r] of Object.entries(obj(o["rates"], "fx.rates"))) {
    if (!DATE.test(date)) throw new ShapeError("fx.rates: date invalide");
    const eur = finite(obj(r, "fx.rates." + date), "EUR", "fx.rates." + date);
    if (!(eur > 0)) throw new ShapeError("fx.rates." + date + ".EUR: positif attendu");
    out.push({ date, eur });
  }
  return out;
}
