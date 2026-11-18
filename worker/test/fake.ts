/** A fake Alpaca (paper + data) and Frankfurter, recording every call. */
import { DATA_BASE, PAPER_BASE } from "../src/alpaca";
import type { Deps } from "../src/env";
import { FRANKFURTER } from "../src/fx";

// Tuesday 17 November 2026, New York is UTC-5 (EST since 1 November).
export const T = {
  open: Date.UTC(2026, 10, 17, 14, 30), // 9:30 NY
  close: Date.UTC(2026, 10, 17, 21, 0), // 16:00 NY
  nextOpen: Date.UTC(2026, 10, 18, 14, 30),
  at: (hh: number, mm: number) => Date.UTC(2026, 10, 17, hh + 5, mm), // NY wall time on that day
};

export interface FakeOptions {
  isOpen?: boolean;
  account?: Record<string, unknown>;
  accountStatus?: number;
  positions?: unknown[];
  spyCloses?: Record<number, number>; // minute ts -> close
  fx?: Record<string, number>;
}

export function paperAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    account_number: "PA3TESTACCT1",
    status: "ACTIVE",
    currency: "USD",
    cash: "55.07",
    equity: "55.07",
    last_equity: "55.07",
    portfolio_value: "55.07",
    trading_blocked: false,
    account_blocked: false,
    ...over,
  };
}

export function fakeMarket(opts: FakeOptions = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  const o = {
    isOpen: true,
    account: paperAccount(),
    accountStatus: 200,
    positions: [],
    spyCloses: {},
    fx: { "2026-11-13": 0.90481, "2026-11-16": 0.90794 },
    ...opts,
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(url.origin + url.pathname);
    // Like workerd: only "follow" and "manual" exist.
    if (init?.redirect !== undefined && init.redirect !== "follow" && init.redirect !== "manual") {
      throw new TypeError("Invalid redirect value, must be one of \"follow\" or \"manual\"");
    }
    if (url.origin === PAPER_BASE) {
      if (url.pathname === "/v2/clock") {
        return reply({ timestamp: new Date().toISOString(), is_open: o.isOpen, next_open: new Date(o.isOpen ? T.nextOpen : T.open).toISOString(), next_close: new Date(T.close).toISOString() });
      }
      if (url.pathname === "/v2/account") return o.accountStatus === 200 ? reply(o.account) : reply({ message: "forbidden" }, o.accountStatus);
      if (url.pathname === "/v2/positions" && init?.method === "DELETE") return reply(o.positions.map(() => ({ status: 200 })), 207);
      if (url.pathname === "/v2/positions") return reply(o.positions);
      if (url.pathname === "/v2/orders" && init?.method === "DELETE") return reply([{ id: "o1", status: 200 }], 207);
    }
    if (url.origin === DATA_BASE && url.pathname === "/v2/stocks/bars") {
      const start = Date.parse(url.searchParams.get("start") ?? "");
      const bars = Object.entries(o.spyCloses)
        .map(([ts, c]) => ({ ts: Number(ts), c }))
        .filter((b) => b.ts >= start)
        .map((b) => ({ t: new Date(b.ts).toISOString(), o: b.c, h: b.c, l: b.c, c: b.c, v: 1200, n: 30, vw: b.c }));
      return reply({ bars: bars.length ? { SPY: bars } : {}, next_page_token: null });
    }
    if (String(input).startsWith(FRANKFURTER)) {
      const rates: Record<string, { EUR: number }> = {};
      for (const [d, r] of Object.entries(o.fx)) rates[d] = { EUR: r };
      return reply({ amount: 1, base: "USD", rates });
    }
    return reply({ message: "unexpected " + url.href }, 599);
  };
  return { fetch: fetchFn, calls };
}
