import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleApi } from "../src/api";
import { issueToken } from "../src/auth";
import { planHash, type Plan } from "../src/brain";
import { tick } from "../src/tick";
import { T, fakeMarket } from "./fake";

const NOW = T.at(9, 50); // 17 Nov 2026, New York
const DATE = "2026-11-17";

export function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: DATE + "-AMD-orb",
    kind: "reel",
    symbol: "AMD",
    setup: "orb15",
    or: { high: 160.0, low: 158.0, mid: 159.0 },
    atr_5m: 0.6,
    trigger: { type: "close_above", bar: "5m", level: 160.06, buffer_atr: 0.1, delay_s: [60, 240] },
    stop: { rule: "or-mid-0.25atr", price: 158.83 },
    target: { r: 2, price: 162.49, avoid_round: true },
    size: { risk_usd: 0.55, max_notional_usd: 41.25 },
    window: ["09:45", "15:30"],
    flat_by: "15:55",
    timemachine: { verdict: "Leans toward the target: at 2R …", seed: 19, replays: 10000, target_first: 0.31, stop_first: 0.22, neither: 0.47, avg_r: 0.18, avg_r_after_costs: 0.12, history_trades: 21, history_avg_r: 0.2, history_avg_r_after_costs: 0.11, slippage_pct: 0.05 },
    risk_pass: "0123456789abcdef",
    crowd_score: 3.2,
    adaptations: ["entrée décalée 1–4 min", "stop milieu − 0,25 ATR"],
    why: "Cassure propre, volume 1,8× la normale, pas de résultats aujourd'hui.",
    ...over,
  };
}

const TM = plan().timemachine as NonNullable<Plan["timemachine"]>;

function body(plans: Plan[], over: Record<string, unknown> = {}) {
  return { pass: "cassures", date: DATE, generated_at: "2026-11-17T14:48:00Z", equity_usd: 55, limits: { max_loss_trade_usd: 0.55, max_daily_loss_usd: 1.65, max_trades: 3 }, plans, ...over };
}

let claude = "";
let app = "";
async function call(method: string, path: string, token: string, data?: unknown, deps = fakeMarket()) {
  const init: RequestInit = { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } };
  if (data !== undefined) init.body = JSON.stringify(data);
  const res = await handleApi(new Request("https://pile.example.workers.dev" + path, init), { ...env, ALPACA_KEY_ID: "k", ALPACA_SECRET_KEY: "s" }, NOW, deps);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  for (const t of ["config", "kv_state", "devices", "plans", "journal", "passes", "crowd_daily", "alerts", "equity_points", "bars_1m", "fx_rates", "spy_points"]) await env.DB.prepare("DELETE FROM " + t).run();
  claude = (await issueToken(env, "claude", "passes", NOW)).token;
  app = (await issueToken(env, "app", "iPhone", NOW)).token;
});

describe("POST /api/plans", () => {
  it("arms a plan that passes every check, and shows it in state", async () => {
    const r = await call("POST", "/api/plans", claude, body([plan(), plan({ id: DATE + "-AMD-orb-fantome", kind: "fantome", timemachine: null, risk_pass: null })]));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accepted: [DATE + "-AMD-orb", DATE + "-AMD-orb-fantome"], rejected: [], disarmed: [] });
    const s = await call("GET", "/api/state", app);
    expect((s.body["plans"] as unknown[]).length).toBe(2);
    expect((s.body["plans"] as Record<string, unknown>[])[0]).toMatchObject({ kind: "reel", symbol: "AMD", status: "arme", level: 160.06, verdict: "Leans toward the target" });
    const row = await env.DB.prepare("SELECT plan_hash FROM plans WHERE id = ?").bind(DATE + "-AMD-orb").first<{ plan_hash: string }>();
    expect(row?.plan_hash).toBe(await planHash(plan()));
  });

  it.each([
    ["no trader-risk PASS", { risk_pass: null }, "PASS"],
    ["a coin-flip verdict", { timemachine: { ...TM, verdict: "Close to a coin flip: …" } }, "filtre strict"],
    ["avg R after costs ≤ 0", { timemachine: { ...TM, avg_r_after_costs: -0.01 } }, "rejeux"],
    ["history avg R after costs ≤ 0", { timemachine: { ...TM, history_avg_r_after_costs: 0 } }, "historique"],
    ["another seed", { timemachine: { ...TM, seed: 7 } }, "graine"],
    ["a stop above entry", { stop: { rule: "x", price: 160.5 } }, "stop"],
    ["reward:risk under 1", { target: { r: 2, price: 160.8, avoid_round: true } }, "gain/risque"],
    ["risk over the limit", { size: { risk_usd: 0.9, max_notional_usd: 40 } }, "risque"],
    ["an entry after 15:30", { window: ["09:45", "15:45"] as [string, string] }, "fenêtre"],
    ["a mismatched id", { id: "2026-11-16-AMD-orb" }, "date"],
  ])("refuses a real plan with %s, and alerts", async (_name, over, why) => {
    const r = await call("POST", "/api/plans", claude, body([plan(over as Partial<Plan>)]));
    expect(r.status).toBe(422);
    expect((r.body["rejected"] as { reason: string }[])[0]?.reason).toContain(why);
    const a = await env.DB.prepare("SELECT code FROM alerts").all<{ code: string }>();
    expect(a.results.map((x) => x.code)).toEqual(["plan_refused"]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM plans").first("n")).toBe(0);
  });

  it("refuses malformed bodies (schema)", async () => {
    expect((await call("POST", "/api/plans", claude, body([{ ...plan(), symbol: "amd" }]))).status).toBe(400);
    expect((await call("POST", "/api/plans", claude, body([plan()], { date: "17/11/2026" }))).status).toBe(400);
  });

  it("refuses plans for another day", async () => {
    const r = await call("POST", "/api/plans", claude, body([plan({ id: "2026-11-18-AMD-orb" })], { date: "2026-11-18" }));
    expect((r.body["rejected"] as { reason: string }[])[0]?.reason).toContain("pas aujourd'hui");
  });

  it("holds at most 3 real trades a day, ghosts aside", async () => {
    const ids = ["AMD", "PLTR", "RIVN", "SOFI"].map((s) => plan({ id: DATE + "-" + s + "-orb", symbol: s }));
    const r = await call("POST", "/api/plans", claude, body(ids));
    expect((r.body["accepted"] as string[]).length).toBe(3);
    expect((r.body["rejected"] as { reason: string }[])[0]?.reason).toContain("limite 3");
    const g = await call("POST", "/api/plans", claude, body([plan({ id: DATE + "-SOFI-orb-fantome", symbol: "SOFI", kind: "fantome", timemachine: null, risk_pass: null })]));
    expect(g.status).toBe(200);
  });

  it("refuses real plans during a pause, still records the ghost", async () => {
    await call("POST", "/api/pause", app, { active: true });
    const r = await call("POST", "/api/plans", claude, body([plan(), plan({ id: DATE + "-AMD-orb-fantome", kind: "fantome", timemachine: null, risk_pass: null })]));
    expect(r.body["accepted"]).toEqual([DATE + "-AMD-orb-fantome"]);
    expect((r.body["rejected"] as { reason: string }[])[0]?.reason).toContain("pause");
  });

  it("disarms, and lets a later pass re-arm", async () => {
    await call("POST", "/api/plans", claude, body([plan()]));
    const d = await call("POST", "/api/plans", claude, body([], { pass: "mi-seance", disarm: [DATE + "-AMD-orb"] }));
    expect(d.body["disarmed"]).toEqual([DATE + "-AMD-orb"]);
    expect(await env.DB.prepare("SELECT status FROM plans").first("status")).toBe("desarme");
  });

  it("is claude scope only", async () => {
    expect((await call("POST", "/api/plans", app, body([plan()]))).status).toBe(403);
  });
});

describe("passes, journal, alerts, crowd", () => {
  it("records passes; an error raises a critical alert; state shows the last pass", async () => {
    expect((await call("POST", "/api/passes", claude, { pass: "avant-ouverture", status: "start" })).status).toBe(201);
    await call("POST", "/api/passes", claude, { pass: "avant-ouverture", status: "error", detail: "Yahoo injoignable" });
    const s = await call("GET", "/api/state", app);
    expect((s.body["health"] as Record<string, Record<string, unknown>>)["last_claude_pass"]).toMatchObject({ pass: "avant-ouverture", status: "error" });
    expect(await env.DB.prepare("SELECT level FROM alerts WHERE code = 'pass_error'").first("level")).toBe("critical");
  });

  it("keeps the journal and serves it to the app", async () => {
    await call("POST", "/api/journal", claude, { pass: "bilan", date: DATE, kind: "bilan", title: "Mardi", body: "Aucun trade armé.", data: { toi: 50.1 } });
    const j = await call("GET", "/api/journal?date=" + DATE, app);
    expect((j.body["entries"] as Record<string, unknown>[])[0]).toMatchObject({ kind: "bilan", body: "Aucun trade armé.", data: { toi: 50.1 } });
    expect(((await call("GET", "/api/state", app)).body["last_bilan_date"])).toBe(DATE);
  });

  it("takes alerts from Claude and the crowd score", async () => {
    expect((await call("POST", "/api/alerts", claude, { level: "warn", code: "yahoo_blocked", message: "Yahoo bloque : repli IEX." })).status).toBe(201);
    expect((await call("POST", "/api/crowd", claude, { date: DATE, score: 3.2, components: { popularite: 0.7, evident: 0.8 } })).status).toBe(201);
    expect((await call("GET", "/api/state", app)).body["crowd"]).toMatchObject({ score: 3.2, date: DATE });
  });
});

describe("GET /api/bars (fallback relay)", () => {
  it("relays IEX bars from the data host, untouched", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(9, 31)]: 100 } });
    const r = await call("GET", "/api/bars?symbols=SPY&timeframe=1Min&start=2026-11-17T14:30:00Z", claude, undefined, m);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body["bars"] as object)).toEqual(["SPY"]);
    expect(m.calls).toEqual(["https://data.alpaca.markets/v2/stocks/bars"]);
  });
  it.each([
    "/api/bars?symbols=spy&start=2026-11-17",
    "/api/bars?symbols=A,B,C,D,E,F,G,H,I,J,K&start=2026-11-17",
    "/api/bars?symbols=SPY&timeframe=1Hour&start=2026-11-17",
    "/api/bars?symbols=SPY&start=2025-01-01",
    "/api/bars?symbols=SPY&start=yesterday",
  ])("refuses %s", async (path) => {
    expect((await call("GET", path, claude)).status).toBe(400);
  });
  it("is claude scope only", async () => {
    expect((await call("GET", "/api/bars?symbols=SPY&start=2026-11-17", app)).status).toBe(403);
  });
});

describe("watcher side", () => {
  const keyed = () => ({ ...env, ALPACA_KEY_ID: "k", ALPACA_SECRET_KEY: "s" });
  it("reads the skill's GitHub popularity once a day", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(9, 59)]: 670 } });
    await tick(keyed(), T.at(10, 0), m);
    await tick(keyed(), T.at(10, 1), m);
    expect(m.calls.filter((c) => c.startsWith("https://api.github.com"))).toHaveLength(1);
    expect(await env.DB.prepare("SELECT stars FROM crowd_daily").first("stars")).toBe(412);
  });

  it("alerts on a missing pass, once the schedule is live", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(10, 9)]: 670 } });
    await tick(keyed(), T.at(10, 10), m); // nothing ever reported: no alert
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE code = 'pass_missing'").first("n")).toBe(0);
    await env.DB.prepare("INSERT INTO passes (ts, date, pass, status) VALUES (0, '2026-11-16', 'bilan', 'done')").run();
    await env.DB.prepare("INSERT INTO passes (ts, date, pass, status) VALUES (0, ?, 'avant-ouverture', 'done')").bind(DATE).run();
    await tick(keyed(), T.at(10, 11), m);
    await tick(keyed(), T.at(10, 12), m);
    const rows = await env.DB.prepare("SELECT message FROM alerts WHERE code = 'pass_missing'").all<{ message: string }>();
    expect(rows.results.map((r) => r.message)).toEqual([expect.stringContaining("cassures")]);
  });
});
