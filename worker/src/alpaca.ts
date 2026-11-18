/**
 * The only door to Alpaca. Rule 0.1: paper only, forever.
 *
 * - The trading host is a hard-coded constant. No env var, setting or argument
 *   can change it: callers pass a path, never a URL, and the resolved URL must
 *   keep the paper origin or the call throws before any network request.
 * - Market data goes to the data host, GET only, on read-only routes.
 * - Redirects are never followed (a redirect could leave the paper origin).
 * - Keys travel only in request headers; no error message ever contains them.
 */

export const PAPER_BASE = "https://paper-api.alpaca.markets" as const;
export const DATA_BASE = "https://data.alpaca.markets" as const;

const PAPER_ORIGIN = new URL(PAPER_BASE).origin;
const DATA_ORIGIN = new URL(DATA_BASE).origin;

// A relative path under /v2/, with a query string at most. No scheme, no host,
// no "//", no backslash, no "..", no encoded slash or dot tricks.
const SAFE_PATH = /^\/v2\/[A-Za-z0-9_\-/.]*(\?[A-Za-z0-9_\-.,:=&%]*)?$/;
const DATA_ROUTES = /^\/v2\/stocks\//;

export class PaperLockError extends Error {
  override readonly name = "PaperLockError";
}

export class AlpacaError extends Error {
  override readonly name = "AlpacaError";
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

function resolve(base: string, origin: string, path: string): URL {
  if (typeof path !== "string" || !SAFE_PATH.test(path) || path.includes("//") || path.includes("..")) {
    throw new PaperLockError("refused path: only relative /v2/ paths are allowed");
  }
  // Encoded separators are refused in the path; the query (page tokens are
  // base64 and may hold "/") cannot change the origin.
  if (/%2f|%5c|%2e/i.test(path.split("?")[0] ?? "")) {
    throw new PaperLockError("refused path: encoded separators are not allowed");
  }
  const url = new URL(path, base);
  if (url.origin !== origin) {
    throw new PaperLockError("refused URL: it would leave " + origin);
  }
  return url;
}

/** URL on the paper trading API. Throws PaperLockError for anything else. */
export function tradingUrl(path: string): URL {
  return resolve(PAPER_BASE, PAPER_ORIGIN, path);
}

/** URL on the market data API (read-only stock routes). */
export function dataUrl(path: string): URL {
  const url = resolve(DATA_BASE, DATA_ORIGIN, path);
  if (!DATA_ROUTES.test(url.pathname)) {
    throw new PaperLockError("refused data route: only /v2/stocks/ is used");
  }
  return url;
}

export interface AlpacaKeys {
  readonly keyId: string;
  readonly secretKey: string;
}

export type Fetcher = (input: URL, init: RequestInit) => Promise<Response>;

export type TradingMethod = "GET" | "POST" | "DELETE" | "PATCH";

async function call(fetcher: Fetcher, url: URL, keys: AlpacaKeys, method: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": keys.keyId,
    "APCA-API-SECRET-KEY": keys.secretKey,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetcher(url, init);
  if (res.status >= 300 && res.status < 400) {
    throw new PaperLockError("refused redirect from " + url.origin);
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const obj = (parsed ?? {}) as { code?: unknown; message?: unknown };
    const code = obj.code === undefined || obj.code === null ? null : String(obj.code);
    const message = typeof obj.message === "string" ? obj.message.slice(0, 300) : "HTTP " + res.status;
    throw new AlpacaError(res.status, code, method + " " + url.pathname + ": " + message);
  }
  return parsed;
}

/** One call to the paper trading API. */
export async function trading(fetcher: Fetcher, keys: AlpacaKeys, method: TradingMethod, path: string, body?: unknown): Promise<unknown> {
  return call(fetcher, tradingUrl(path), keys, method, body);
}

/** One read on the market data API (always GET). */
export async function marketData(fetcher: Fetcher, keys: AlpacaKeys, path: string): Promise<unknown> {
  return call(fetcher, dataUrl(path), keys, "GET");
}

/**
 * Market data passed through untouched (no JSON parsing: a 60-day request is
 * hundreds of kB and the free plan has 10 ms of CPU). GET only, data host
 * only, redirects refused.
 */
export async function marketDataRaw(fetcher: Fetcher, keys: AlpacaKeys, path: string): Promise<Response> {
  const url = dataUrl(path);
  const res = await fetcher(url, {
    method: "GET",
    headers: { "APCA-API-KEY-ID": keys.keyId, "APCA-API-SECRET-KEY": keys.secretKey, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) throw new PaperLockError("refused redirect from " + url.origin);
  return res;
}
