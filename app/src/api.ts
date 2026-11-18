/** The watcher's API, same origin. The app token lives in this installed app's storage only. */

export interface Health {
  readonly ok: boolean;
  readonly at: number | null;
  readonly code?: string;
}

export interface State {
  readonly now: number;
  readonly paper: true;
  readonly paused: { active: boolean; reason: string | null; since: number | null; until: number | null };
  readonly session: { open: boolean; next_open: number; next_close: number } | null;
  readonly money: {
    as_of: number;
    usd: number;
    cash_usd: number | null;
    eur: number;
    base_eur: number;
    delta_eur: number;
    delta_pct: number;
    fx: { eur_per_usd: number; date: string };
  } | null;
  readonly day0: { date: string; usd: number; eur_per_usd: number; fx_date: string } | null;
  readonly positions: readonly {
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPl: number;
    stop?: number;
    target?: number;
  }[];
  readonly limits: {
    equity_usd: number;
    max_loss_trade_usd: number;
    max_daily_loss_usd: number;
    max_trades: number;
    max_position_usd: number;
    cash_buffer_usd: number;
  } | null;
  readonly passes: readonly { name: string; at: number }[];
  readonly today_is_trading?: boolean;
  readonly plans: readonly PlanSummary[];
  readonly last_bilan_date?: string | null;
  readonly next_pass: { name: string; at: number } | null;
  readonly crowd: { score: number } | null;
  readonly alerts_open: number;
  readonly health: {
    last_tick: number | null;
    last_claude_pass: { at: number; pass: string } | null;
    alpaca: Health | null;
    data: Health | null;
    fx: (Health & { rate_date: string | null }) | null;
  };
}

export interface PlanSummary {
  readonly id: string;
  readonly kind: "reel" | "fantome";
  readonly symbol: string;
  readonly status: "arme" | "desarme" | "declenche" | "execute" | "expire";
  readonly level: number;
  readonly stop: number;
  readonly target: number;
  readonly why: string;
  readonly verdict: string | null;
}

export type Range = "1j" | "1s" | "1m" | "tout";

export interface Series {
  readonly range: Range;
  readonly base_eur: number;
  readonly points: readonly { t: number; toi: number | null; sp: number | null; fantome: number | null }[];
  readonly markers: readonly { t: number; kind: "achat" | "vente"; symbol: string }[];
}

export interface Trade {
  readonly id: string;
  readonly symbol: string;
  readonly entry_at: number;
  readonly exit_at: number | null;
  readonly exit_reason: string | null;
  readonly pnl_eur: number | null;
}

const TOKEN_KEY = "pile.token";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}
export function setToken(token: string): void {
  storage()?.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  storage()?.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the token is refused, so the app can return to pairing. */
export const UNAUTHORIZED = "pile:unauthorized";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const init: RequestInit = { method, headers, cache: "no-store" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "offline", "pas de réseau");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED));
    throw new ApiError(res.status, data?.error?.code ?? "http_" + res.status, data?.error?.message ?? "erreur " + res.status);
  }
  return data as T;
}

export const api = {
  state: () => call<State>("GET", "/api/state"),
  series: (range: Range) => call<Series>("GET", "/api/series?range=" + range),
  trades: () => call<{ trades: Trade[] }>("GET", "/api/trades"),
  pause: (active: boolean) => call<{ paused: State["paused"] }>("POST", "/api/pause", { active }),
  kill: () => call<{ paused: true; guard: string; cancelled_orders: number; closed_positions: number; errors: string[] }>("POST", "/api/kill"),
  pair: (code: string, name: string) => call<{ token: string }>("POST", "/api/pair", { code, name }),
  pairCode: () => call<{ code: string; expires_at: number }>("POST", "/api/pair/code"),
  claudeToken: () => call<{ token: string; device_id: string }>("POST", "/api/tokens", { scope: "claude", name: "Passages de Claude" }),
};

/** Last good answers, kept for offline display with their time. */
export function remember(key: string, value: unknown): void {
  try {
    storage()?.setItem("pile.cache." + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* storage full or blocked: the app still works online */
  }
}

export function recall<T>(key: string): { at: number; value: T } | null {
  try {
    const raw = storage()?.getItem("pile.cache." + key);
    return raw ? (JSON.parse(raw) as { at: number; value: T }) : null;
  } catch {
    return null;
  }
}
