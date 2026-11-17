import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { configGet } from "../src/store";
import { tick, type Day0 } from "../src/tick";
import { T, fakeMarket, paperAccount } from "./fake";

const KEYED = { ...env, ALPACA_KEY_ID: "test-key-id", ALPACA_SECRET_KEY: "test-secret" };

async function count(table: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + table).first<{ n: number }>();
  return r?.n ?? 0;
}

async function alerts(): Promise<{ code: string; level: string; message: string }[]> {
  return (await env.DB.prepare("SELECT code, level, message FROM alerts ORDER BY id").all<{ code: string; level: string; message: string }>()).results;
}

beforeEach(async () => {
  for (const t of ["config", "kv_state", "equity_points", "spy_points", "fx_rates", "bars_1m", "alerts"]) {
    await env.DB.prepare("DELETE FROM " + t).run();
  }
});

describe("outside the window", () => {
  it("does no I/O at all", async () => {
    const m = fakeMarket();
    for (const at of [T.at(9, 24), T.at(16, 11), Date.UTC(2026, 10, 21, 16, 0)]) {
      const r = await tick(KEYED, at, m);
      expect(r).toEqual({ status: "outside_window", subrequests: 0 });
    }
    expect(m.calls).toEqual([]);
    expect(await count("kv_state")).toBe(0);
  });
});

describe("in the window", () => {
  it("alerts once when the Alpaca keys are missing", async () => {
    const m = fakeMarket();
    await tick(env, T.at(10, 0), m);
    await tick(env, T.at(10, 1), m);
    expect(m.calls).toEqual([]);
    expect((await alerts()).map((a) => a.code)).toEqual(["keys_missing"]);
  });

  it("before the open: one clock read, then nothing until the bell", async () => {
    const m = fakeMarket({ isOpen: false });
    expect((await tick(KEYED, T.at(9, 25), m)).status).toBe("market_closed");
    expect((await tick(KEYED, T.at(9, 26), m)).subrequests).toBe(0);
    expect(m.calls.filter((c) => c.endsWith("/v2/clock"))).toHaveLength(1);
    expect(m.calls.some((c) => c.endsWith("/v2/account"))).toBe(false);
  });

  it("records equity, SPY, the ECB rate and day 0", async () => {
    const minute = T.at(10, 0);
    const m = fakeMarket({ spyCloses: { [minute - 120_000]: 670.1, [minute - 60_000]: 671.25 } });
    const r = await tick(KEYED, minute, m);
    expect(r.status).toBe("recorded");
    // clock, account, ECB rates, positions, bars
    expect(r.subrequests).toBe(5);

    const day0 = await configGet<Day0>(env.DB, "day0");
    expect(day0).toMatchObject({ date: "2026-11-17", equityUsd: 55.07, eurPerUsd: 0.90794, fxDate: "2026-11-16", baseEur: 50, spyPrice: 671.25 });
    expect((day0 as Day0).spyShares).toBeCloseTo(50 / 0.90794 / 671.25, 10);

    const eq = await env.DB.prepare("SELECT ts, equity_usd FROM equity_points").all();
    expect(eq.results).toEqual([{ ts: minute, equity_usd: 55.07 }]);
    const spy = await env.DB.prepare("SELECT price, value_usd FROM spy_points").first<{ price: number; value_usd: number }>();
    expect(spy?.price).toBe(671.25);
    expect((spy?.value_usd ?? 0) * 0.90794).toBeCloseTo(50, 8);
    expect(await count("bars_1m")).toBe(2);
    expect(await count("fx_rates")).toBe(2);
  });

  it("stays within a few subrequests per minute once warm", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(9, 58)]: 670, [T.at(9, 59)]: 671 } });
    await tick(KEYED, T.at(10, 0), m);
    m.calls.length = 0;
    const r = await tick(KEYED, T.at(10, 1), m);
    // clock cached, ECB retried at most every 30 min: account, positions, bars
    expect(r.subrequests).toBe(3);
    expect(m.calls.map((c) => c.split("/v2/")[1])).toEqual(["account", "positions", "stocks/bars"]);
  });

  it("is idempotent when a minute is replayed", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(9, 59)]: 670 } });
    await tick(KEYED, T.at(10, 0), m);
    await tick(KEYED, T.at(10, 0), m);
    expect(await count("equity_points")).toBe(1);
    expect(await count("spy_points")).toBe(1);
    expect(await count("bars_1m")).toBe(1);
  });
});

describe("paper guard", () => {
  it("refuses a big account: records nothing, raises one critical alert", async () => {
    const m = fakeMarket({ account: paperAccount({ equity: "100000", last_equity: "100000", cash: "100000", portfolio_value: "100000" }) });
    expect(await tick(KEYED, T.at(10, 0), m)).toMatchObject({ status: "guard_refused", detail: "equity_too_high" });
    await tick(KEYED, T.at(10, 1), m);
    expect(await count("equity_points")).toBe(0);
    expect(await configGet(env.DB, "day0")).toBeNull();
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ code: "guard_equity_too_high", level: "critical" });
    expect(a[0]?.message).not.toContain("PA3TESTACCT1");
    expect(m.calls.some((c) => c.endsWith("/v2/positions"))).toBe(false);
  });

  it("refuses another paper account once day 0 is pinned", async () => {
    const m = fakeMarket({ spyCloses: { [T.at(9, 59)]: 670 } });
    await tick(KEYED, T.at(10, 0), m);
    const other = fakeMarket({ account: paperAccount({ id: "99999999-2222-4333-8444-555555555555" }) });
    expect(await tick(KEYED, T.at(10, 1), other)).toMatchObject({ status: "guard_refused", detail: "account_changed" });
  });

  it("refuses a number without the paper prefix", async () => {
    const m = fakeMarket({ account: paperAccount({ account_number: "3TESTACCT123" }) });
    expect(await tick(KEYED, T.at(10, 0), m)).toMatchObject({ status: "guard_refused", detail: "not_paper_prefix" });
  });

  it("raises a critical alert when Alpaca refuses the keys", async () => {
    const m = fakeMarket({ accountStatus: 401 });
    expect(await tick(KEYED, T.at(10, 0), m)).toMatchObject({ status: "error", detail: "alpaca_auth" });
    expect((await alerts())[0]).toMatchObject({ code: "alpaca_auth", level: "critical" });
    expect(JSON.stringify(await alerts())).not.toContain("test-secret");
  });
});

describe("compaction", () => {
  it("keeps one point per 15 minutes after 30 days, once a day", async () => {
    const old = T.at(10, 0) - 40 * 24 * 3600 * 1000;
    const insert = env.DB.prepare("INSERT INTO equity_points (ts, equity_usd) VALUES (?, 50)");
    await env.DB.batch(Array.from({ length: 30 }, (_, i) => insert.bind(old + i * 60_000)));
    const m = fakeMarket({ isOpen: false });
    await tick(KEYED, T.at(16, 5), m);
    expect(await count("equity_points")).toBe(2);
    await env.DB.prepare("INSERT INTO equity_points (ts, equity_usd) VALUES (?, 50)").bind(old + 60).run();
    await tick(KEYED, T.at(16, 6), m);
    expect(await count("equity_points")).toBe(3);
  });
});
