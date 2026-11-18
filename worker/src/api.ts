/**
 * /api/* router. Same origin as the PWA (static assets of this Worker), so no
 * CORS is needed or sent: browsers block cross-origin reads by default.
 *
 * | Route                         | Scope        |
 * |-------------------------------|--------------|
 * | GET  /api/health              | none         |
 * | GET  /api/state               | app, claude  |
 * | GET  /api/series?range=       | app          |
 * | GET  /api/alerts              | app          |
 * | POST /api/pause               | app          |
 * | POST /api/kill                | app          |
 * | GET  /api/trades              | app          |
 * | POST /api/pair                | none         |
 * | POST /api/pair/code           | app          |
 * | POST /api/tokens              | app          |
 * | GET  /api/devices             | app          |
 * | DELETE /api/devices/:id       | app          |
 * | GET  /api/plans?date=         | app, claude  |
 * | POST /api/plans               | claude       |
 * | POST /api/passes              | claude       |
 * | GET  /api/journal?date=       | app, claude  |
 * | POST /api/journal             | claude       |
 * | POST /api/alerts              | claude       |
 * | GET  /api/crowd               | claude       |
 * | POST /api/crowd               | claude       |
 * | GET  /api/bars?symbols=…      | claude       |
 */
import * as z from "zod/mini";
import { PASS_NAMES, PlansBody, plansOf, storePlans } from "./brain";
import { marketDataRaw } from "./alpaca";
import { AuthError, authenticate, createPairCode, issueToken, pair, type Device, type Scope } from "./auth";
import { defaultDeps, type Deps, type Env } from "./env";
import { killAll } from "./kill";
import { RANGES, buildSeries, type Range } from "./series";
import { buildState, readPause } from "./state";
import { alert, kvPut } from "./store";
import { NY, zoned } from "./time";

const MAX_BODY = 4096;
const MAX_PLANS_BODY = 48 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

async function readBody<T>(request: Request, schema: z.ZodMiniType<T>, max = MAX_BODY): Promise<T> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > max) throw new BadRequest("corps trop gros");
  const text = await request.text();
  if (text.length > max) throw new BadRequest("corps trop gros");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new BadRequest("JSON invalide");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BadRequest("requête invalide : " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "));
  return parsed.data;
}

class BadRequest extends Error {
  override readonly name = "BadRequest";
}

const PairBody = z.object({ code: z.string().check(z.minLength(1), z.maxLength(200)), name: z.optional(z.string().check(z.maxLength(60))) });
const PauseBody = z.object({ active: z.boolean() });
const TokenBody = z.object({ scope: z.enum(["app", "claude"]), name: z.string().check(z.minLength(1), z.maxLength(60)) });
const DATE = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const PassBody = z.object({ pass: z.enum(PASS_NAMES), status: z.enum(["start", "done", "skipped", "error"]), detail: z.optional(z.string().check(z.maxLength(500))) });
const JournalBody = z.object({
  pass: z.enum(PASS_NAMES),
  date: DATE,
  kind: z.enum(["note", "bilan", "candidats"]),
  title: z.optional(z.string().check(z.maxLength(120))),
  body: z.string().check(z.minLength(1), z.maxLength(4000)),
  data: z.optional(z.record(z.string(), z.unknown())),
});
const AlertBody = z.object({ level: z.enum(["info", "warn", "critical"]), code: z.string().check(z.regex(/^[a-z0-9_]{2,40}$/)), message: z.string().check(z.minLength(1), z.maxLength(500)) });
const CrowdBody = z.object({ date: DATE, score: z.number().check(z.gte(0), z.lte(5)), components: z.record(z.string(), z.number().check(z.gte(0), z.lte(1))) });
const BAR_SYMBOLS = /^[A-Z][A-Z.]{0,5}(,[A-Z][A-Z.]{0,5}){0,9}$/;
const BAR_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z)?$/;

export async function handleApi(request: Request, env: Env, now: number, deps: Deps = defaultDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const db = env.DB;
  const auth = (scopes: readonly Scope[]): Promise<Device> => authenticate(env, request, scopes, now);

  try {
    if (path === "/api/health" && method === "GET") {
      return json(200, { ok: true, paper: true });
    }
    if (path === "/api/state" && method === "GET") {
      await auth(["app", "claude"]);
      return json(200, await buildState(db, now));
    }
    if (path === "/api/series" && method === "GET") {
      await auth(["app", "claude"]);
      const range = (url.searchParams.get("range") ?? "1j") as Range;
      if (!RANGES.includes(range)) return fail(400, "bad_range", "range attendu : " + RANGES.join(", "));
      return json(200, await buildSeries(db, range, now));
    }
    if (path === "/api/alerts" && method === "GET") {
      await auth(["app"]);
      const res = await db.prepare("SELECT id, ts, level, source, code, message, acked_at FROM alerts ORDER BY ts DESC LIMIT 50").all();
      return json(200, { alerts: res.results });
    }
    if (path === "/api/pause" && method === "POST") {
      const device = await auth(["app"]);
      const body = await readBody(request, PauseBody);
      const pause = body.active ? { active: true, reason: "manuel (" + device.name + ")", since: now, until: null } : { active: false, reason: null, since: null, until: null };
      await kvPut(db, "pause", pause, now).run();
      return json(200, { paused: await readPause(db, now) });
    }
    if (path === "/api/kill" && method === "POST") {
      const device = await auth(["app"]);
      return json(200, await killAll(env, deps, now, device.name));
    }
    if (path === "/api/trades" && method === "GET") {
      await auth(["app"]);
      // Trades arrive with milestone 5 (paper execution).
      return json(200, { trades: [], next: null });
    }
    if (path === "/api/pair" && method === "POST") {
      const body = await readBody(request, PairBody);
      const { id, token } = await pair(env, body.code, body.name ?? "iPhone", now);
      return json(201, { device_id: id, token, scope: "app" });
    }
    if (path === "/api/pair/code" && method === "POST") {
      const device = await auth(["app"]);
      const { code, expiresAt } = await createPairCode(env, device.id, now);
      return json(201, { code, expires_at: expiresAt });
    }
    if (path === "/api/tokens" && method === "POST") {
      await auth(["app"]);
      const body = await readBody(request, TokenBody);
      const { id, token } = await issueToken(env, body.scope, body.name, now);
      return json(201, { device_id: id, token, scope: body.scope });
    }
    if (path === "/api/devices" && method === "GET") {
      await auth(["app"]);
      const res = await db.prepare("SELECT id, scope, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at").all();
      return json(200, { devices: res.results });
    }
    const revoke = /^\/api\/devices\/([0-9a-f-]{36})$/.exec(path);
    if (revoke && method === "DELETE") {
      await auth(["app"]);
      const res = await db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, revoke[1]).run();
      return res.meta.changes === 1 ? json(200, { revoked: revoke[1] }) : fail(404, "not_found", "appareil inconnu ou déjà révoqué");
    }
    if (path === "/api/plans" && method === "GET") {
      await auth(["app", "claude"]);
      const date = url.searchParams.get("date") ?? zoned(now, NY).date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, "bad_date", "date attendue : AAAA-MM-JJ");
      return json(200, { date, plans: await plansOf(db, date) });
    }
    if (path === "/api/plans" && method === "POST") {
      await auth(["claude"]);
      const body = await readBody(request, PlansBody, MAX_PLANS_BODY);
      const paused = (await readPause(db, now)).active;
      const res = await storePlans(db, body, now, zoned(now, NY).date, paused);
      return json(res.rejected.length && !res.accepted.length && body.plans.length ? 422 : 200, res);
    }
    if (path === "/api/passes" && method === "POST") {
      await auth(["claude"]);
      const body = await readBody(request, PassBody);
      const date = zoned(now, NY).date;
      const stmts = [db.prepare("INSERT INTO passes (ts, date, pass, status, detail) VALUES (?, ?, ?, ?, ?)").bind(now, date, body.pass, body.status, body.detail ?? null)];
      if (body.status !== "start") stmts.push(kvPut(db, "last_claude_pass", { at: now, pass: body.pass, status: body.status }, now));
      if (body.status === "error") stmts.push(alert(db, now, "critical", "claude", "pass_error", "Passage « " + body.pass + " » en erreur : " + (body.detail ?? "sans détail") + ". Pas de trade aujourd'hui depuis ce passage.", "pass_error:" + body.pass + ":" + date));
      await db.batch(stmts);
      return json(201, { ok: true, paused: (await readPause(db, now)).active });
    }
    if (path === "/api/journal" && method === "GET") {
      await auth(["app", "claude"]);
      const date = url.searchParams.get("date") ?? zoned(now, NY).date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, "bad_date", "date attendue : AAAA-MM-JJ");
      const res = await db.prepare("SELECT id, ts, date, pass, kind, title, body, data FROM journal WHERE date = ? ORDER BY ts").bind(date).all();
      return json(200, { date, entries: res.results.map((r) => ({ ...r, data: r["data"] ? JSON.parse(r["data"] as string) : null })) });
    }
    if (path === "/api/journal" && method === "POST") {
      await auth(["claude"]);
      const body = await readBody(request, JournalBody, 16 * 1024);
      await db
        .prepare("INSERT INTO journal (ts, date, pass, kind, title, body, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(now, body.date, body.pass, body.kind, body.title ?? null, body.body, body.data ? JSON.stringify(body.data) : null)
        .run();
      return json(201, { ok: true });
    }
    if (path === "/api/alerts" && method === "POST") {
      await auth(["claude"]);
      const body = await readBody(request, AlertBody);
      await alert(db, now, body.level, "claude", body.code, body.message, body.code + ":" + zoned(now, NY).date + ":" + Math.floor(now / 3_600_000)).run();
      return json(201, { ok: true });
    }
    if (path === "/api/crowd" && method === "GET") {
      await auth(["claude"]);
      const res = await db.prepare("SELECT date, stars, forks, score, components FROM crowd_daily ORDER BY date DESC LIMIT 14").all();
      return json(200, { days: res.results.map((r) => ({ ...r, components: r["components"] ? JSON.parse(r["components"] as string) : null })) });
    }
    if (path === "/api/crowd" && method === "POST") {
      await auth(["claude"]);
      const body = await readBody(request, CrowdBody);
      await db
        .prepare("INSERT INTO crowd_daily (date, stars, forks, fetched_at, score, components) VALUES (?, 0, 0, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET score = excluded.score, components = excluded.components")
        .bind(body.date, now, body.score, JSON.stringify(body.components))
        .run();
      return json(201, { ok: true });
    }
    if (path === "/api/bars" && method === "GET") {
      await auth(["claude"]);
      // Fallback when Yahoo is blocked (brief 12): the watcher relays IEX bars with its own keys.
      const symbols = url.searchParams.get("symbols") ?? "";
      const timeframe = url.searchParams.get("timeframe") ?? "5Min";
      const start = url.searchParams.get("start") ?? "";
      const end = url.searchParams.get("end");
      const pageToken = url.searchParams.get("page_token");
      if (!BAR_SYMBOLS.test(symbols)) return fail(400, "bad_symbols", "1 à 10 symboles, séparés par des virgules");
      if (!["1Min", "5Min", "15Min", "1Day"].includes(timeframe)) return fail(400, "bad_timeframe", "1Min, 5Min, 15Min ou 1Day");
      if (!BAR_TIME.test(start) || (end !== null && !BAR_TIME.test(end))) return fail(400, "bad_time", "start/end : AAAA-MM-JJ ou AAAA-MM-JJTHH:MM:SSZ");
      if (now - Date.parse(start) > 100 * 86_400_000) return fail(400, "too_far", "100 jours au plus");
      if (pageToken !== null && !/^[A-Za-z0-9+/=_-]{1,400}$/.test(pageToken)) return fail(400, "bad_page_token", "page_token invalide");
      if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) return fail(503, "keys_missing", "clés Alpaca absentes");
      const q = new URLSearchParams({ symbols, timeframe, start, feed: "iex", adjustment: "raw", limit: "10000", sort: "asc" });
      if (end) q.set("end", end);
      if (pageToken) q.set("page_token", pageToken);
      const upstream = await marketDataRaw((u, i) => deps.fetch(u, i), { keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY }, "/v2/stocks/bars?" + q.toString());
      return new Response(upstream.body, { status: upstream.status, headers: SECURITY_HEADERS });
    }
    return fail(404, "not_found", "route inconnue");
  } catch (e) {
    if (e instanceof AuthError) return fail(e.status, e.code, e.message);
    if (e instanceof BadRequest) return fail(400, "bad_request", e.message);
    console.error(JSON.stringify({ api_error: e instanceof Error ? e.name + ": " + e.message : "unknown", path }));
    return fail(500, "internal", "erreur interne");
  }
}
