import type { Page, Route } from "@playwright/test";

// Tuesday 17 Nov 2026, 17:00 Paris (11:00 New York): session open.
export const NOW = Date.UTC(2026, 10, 17, 16, 0);
const OPEN = Date.UTC(2026, 10, 17, 14, 30);

/** A deterministic, realistic day: day 0 at 55 $ × 0.91 = 50.05 €, drifting. */
export function series() {
  let seed = 19;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const points = [];
  let toi = 50.05;
  let sp = 50.0;
  for (let t = OPEN; t <= NOW; t += 60_000) {
    toi += rnd() * 0.06 + 0.0012;
    sp += rnd() * 0.05 + 0.0004;
    points.push({ t, toi: Math.round(toi * 1e4) / 1e4, sp: Math.round(sp * 1e4) / 1e4, fantome: null });
  }
  return { range: "1j", base_eur: 50, bucket_ms: 60_000, points, markers: [], day0: { ts: OPEN, date: "2026-11-17" } };
}

export function state(over: Record<string, unknown> = {}) {
  const pts = series().points;
  const last = pts[pts.length - 1]!;
  const usd = Math.round((last.toi / 0.91) * 100) / 100;
  return {
    now: NOW,
    paper: true,
    paused: { active: false, reason: null, since: null, until: null } as { active: boolean; reason: string | null; since: number | null; until: number | null },
    session: { open: true, next_open: Date.UTC(2026, 10, 18, 14, 30), next_close: Date.UTC(2026, 10, 17, 21, 0) },
    money: { as_of: NOW, usd, cash_usd: usd, eur: Math.round(usd * 0.91 * 100) / 100, base_eur: 50, delta_eur: Math.round((usd * 0.91 - 50) * 100) / 100, delta_pct: Math.round(((usd * 0.91 - 50) / 50) * 1000) / 10, fx: { eur_per_usd: 0.91, date: "2026-11-17" } },
    day0: { date: "2026-11-17", usd: 55, eur_per_usd: 0.91, fx_date: "2026-11-17" },
    positions: [],
    plans: [],
    limits: { equity_usd: usd, max_loss_trade_usd: 0.55, max_daily_loss_usd: 1.65, max_trades: 3, max_position_usd: 41.25, cash_buffer_usd: 5.5 },
    passes: [
      { name: "avant-ouverture", at: Date.UTC(2026, 10, 17, 14, 15) },
      { name: "cassures", at: Date.UTC(2026, 10, 17, 14, 47) },
      { name: "mi-seance", at: Date.UTC(2026, 10, 17, 17, 0) },
      { name: "bilan", at: Date.UTC(2026, 10, 17, 21, 15) },
    ],
    next_pass: { name: "mi-seance", at: Date.UTC(2026, 10, 17, 17, 0) },
    crowd: null,
    alerts_open: 0,
    health: {
      last_tick: NOW - 20_000,
      last_claude_pass: null,
      alpaca: { ok: true, at: NOW - 20_000 },
      data: { ok: true, at: NOW - 20_000 },
      fx: { ok: true, at: NOW - 3_600_000, rate_date: "2026-11-17" },
    },
    ...over,
  };
}

export interface Mock {
  calls: string[];
  state: ReturnType<typeof state>;
}

/** Route /api/* to an in-test watcher. */
export async function mockApi(page: Page, opts: { paired?: boolean } = {}): Promise<Mock> {
  const mock: Mock = { calls: [], state: state() };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    mock.calls.push(req.method() + " " + url.pathname);
    if (url.pathname === "/api/pair") {
      const body = req.postDataJSON() as { code: string };
      return body.code === "BOOTSTRAP-PHRASE-OK" ? json(route, { token: "pile_" + "a".repeat(43) }, 201) : json(route, { error: { code: "bad_code", message: "code invalide" } }, 401);
    }
    if (url.pathname === "/api/state") return json(route, mock.state);
    if (url.pathname === "/api/series") return json(route, series());
    if (url.pathname === "/api/trades") return json(route, { trades: [], next: null });
    if (url.pathname === "/api/pause") {
      const { active } = req.postDataJSON() as { active: boolean };
      mock.state = { ...mock.state, paused: { active, reason: active ? "manuel (iPhone)" : null, since: active ? NOW : null, until: null } };
      return json(route, { paused: mock.state.paused });
    }
    if (url.pathname === "/api/kill") return json(route, { paused: true, guard: "ok", cancelled_orders: 0, closed_positions: 0, errors: [] });
    if (url.pathname === "/api/pair/code") return json(route, { code: "K7M2Q9XA", expires_at: Date.now() + 600_000 }, 201);
    return json(route, { error: { code: "not_found", message: "?" } }, 404);
  });
  if (opts.paired !== false) {
    await page.addInitScript(() => localStorage.setItem("pile.token", "pile_" + "a".repeat(43)));
  }
  return mock;
}
