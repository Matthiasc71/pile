import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleApi } from "../src/api";
import { createPairCode, issueToken } from "../src/auth";
import { tick } from "../src/tick";
import { T, fakeMarket } from "./fake";

const NOW = T.at(10, 5);

async function call(method: string, path: string, opts: { token?: string; body?: unknown; at?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const res = await handleApi(new Request("https://pile.example.workers.dev" + path, init), env, opts.at ?? NOW);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  for (const t of ["config", "kv_state", "devices", "pair_codes", "equity_points", "spy_points", "fx_rates", "bars_1m", "alerts"]) {
    await env.DB.prepare("DELETE FROM " + t).run();
  }
});

describe("authentication", () => {
  it("health is public, everything else needs a token", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
    expect((await call("GET", "/api/state")).status).toBe(401);
    expect((await call("GET", "/api/state", { token: "pile_" + "x".repeat(43) })).status).toBe(401);
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });

  it("stores only a hash of each token", async () => {
    const { token } = await issueToken(env, "app", "test", NOW);
    const rows = await env.DB.prepare("SELECT token_hash FROM devices").all<{ token_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain(token.slice(5));
  });

  it("separates the app and claude scopes", async () => {
    const claude = (await issueToken(env, "claude", "passes", NOW)).token;
    expect((await call("GET", "/api/state", { token: claude })).status).toBe(200);
    expect((await call("GET", "/api/series?range=1j", { token: claude })).status).toBe(403);
    expect((await call("POST", "/api/pause", { token: claude, body: { active: true } })).status).toBe(403);
    expect((await call("POST", "/api/tokens", { token: claude, body: { scope: "app", name: "x" } })).status).toBe(403);
  });

  it("revoked tokens stop working", async () => {
    const app = await issueToken(env, "app", "phone", NOW);
    const other = await issueToken(env, "app", "laptop", NOW);
    expect((await call("DELETE", "/api/devices/" + other.id, { token: app.token })).status).toBe(200);
    expect((await call("GET", "/api/state", { token: other.token })).status).toBe(401);
  });
});

describe("pairing", () => {
  it("the bootstrap passphrase works exactly once", async () => {
    const first = await call("POST", "/api/pair", { body: { code: "bootstrap-passphrase-for-tests", name: "iPhone" } });
    expect(first.status).toBe(201);
    expect(first.body["token"]).toMatch(/^pile_[A-Za-z0-9_-]{43}$/);
    expect((await call("GET", "/api/state", { token: first.body["token"] as string })).status).toBe(200);
    const again = await call("POST", "/api/pair", { body: { code: "bootstrap-passphrase-for-tests" } });
    expect(again.status).toBe(401);
  });

  it("a code from a paired device works once, within 10 minutes", async () => {
    const app = await issueToken(env, "app", "phone", NOW);
    const made = await call("POST", "/api/pair/code", { token: app.token });
    const code = made.body["code"] as string;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    // typed in lower case with a dash: still accepted
    const typed = code.slice(0, 4).toLowerCase() + "-" + code.slice(4);
    expect((await call("POST", "/api/pair", { body: { code: typed } })).status).toBe(201);
    expect((await call("POST", "/api/pair", { body: { code } })).status).toBe(401);

    const late = await createPairCode(env, app.id, NOW);
    expect((await call("POST", "/api/pair", { body: { code: late.code }, at: NOW + 10 * 60_000 + 1 })).status).toBe(401);
  });

  it("locks for 15 minutes after 5 wrong codes, even for a right one", async () => {
    const app = await issueToken(env, "app", "phone", NOW);
    const { code } = await createPairCode(env, app.id, NOW);
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/api/pair", { body: { code: "ZZZZZZZZ" } })).status).toBe(401);
    }
    expect((await call("POST", "/api/pair", { body: { code } })).status).toBe(429);
    expect((await call("POST", "/api/pair", { body: { code }, at: NOW + 15 * 60_000 + 1 })).status).toBe(401); // expired by then
  });

  it("refuses malformed bodies", async () => {
    expect((await call("POST", "/api/pair", { body: { nope: 1 } })).status).toBe(400);
  });
});

describe("state and series", () => {
  it("shows money in euros against the 50 € line, and the pause", async () => {
    const keyed = { ...env, ALPACA_KEY_ID: "k", ALPACA_SECRET_KEY: "s" };
    const m = fakeMarket({ spyCloses: { [T.at(9, 58)]: 670, [T.at(9, 59)]: 672 } });
    await tick(keyed, T.at(10, 0), m);
    const app = (await issueToken(env, "app", "phone", NOW)).token;

    const s = await call("GET", "/api/state", { token: app });
    expect(s.status).toBe(200);
    expect(s.body["paper"]).toBe(true);
    const money = s.body["money"] as Record<string, unknown>;
    expect(money["usd"]).toBe(55.07);
    expect(money["eur"]).toBe(50); // 55.07 × 0.90794 = 50.0003
    expect(money["base_eur"]).toBe(50);
    expect((s.body["next_pass"] as Record<string, unknown>)["name"]).toBe("mi-seance");
    expect((s.body["paused"] as Record<string, unknown>)["active"]).toBe(false);

    expect((await call("POST", "/api/pause", { token: app, body: { active: true } })).status).toBe(200);
    expect(((await call("GET", "/api/state", { token: app })).body["paused"] as Record<string, unknown>)["active"]).toBe(true);
  });

  it("converts each point at the rate of its own day", async () => {
    const day1 = T.at(10, 0) - 24 * 3600 * 1000; // Monday 16 Nov
    const day2 = T.at(10, 0); // Tuesday 17 Nov
    await env.DB.batch([
      env.DB.prepare("INSERT INTO config (key, value, updated_at) VALUES ('day0', ?, 0)").bind(JSON.stringify({ ts: day1, date: "2026-11-16", spyShares: 0.1 })),
      env.DB.prepare("INSERT INTO fx_rates VALUES ('2026-11-16', 0.9, 0), ('2026-11-17', 0.8, 0)"),
      env.DB.prepare("INSERT INTO equity_points (ts, equity_usd) VALUES (?, 100), (?, 100)").bind(day1, day2),
      env.DB.prepare("INSERT INTO spy_points (ts, price, value_usd) VALUES (?, 500, 50), (?, 510, 51)").bind(day1, day2),
    ]);
    const app = (await issueToken(env, "app", "phone", NOW)).token;
    const s = await call("GET", "/api/series?range=1s", { token: app });
    expect(s.status).toBe(200);
    expect(s.body["points"]).toEqual([
      { t: day1, toi: 90, sp: 45, fantome: null },
      { t: day2, toi: 80, sp: 40.8, fantome: null },
    ]);
    expect((await call("GET", "/api/series?range=2j", { token: app })).status).toBe(400);
  });
});
