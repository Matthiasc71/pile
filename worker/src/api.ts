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
 */
import * as z from "zod/mini";
import { AuthError, authenticate, createPairCode, issueToken, pair, type Device, type Scope } from "./auth";
import { defaultDeps, type Deps, type Env } from "./env";
import { killAll } from "./kill";
import { RANGES, buildSeries, type Range } from "./series";
import { buildState, readPause } from "./state";
import { kvPut } from "./store";

const MAX_BODY = 4096;

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

async function readBody<T>(request: Request, schema: z.ZodMiniType<T>): Promise<T> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > MAX_BODY) throw new BadRequest("corps trop gros");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new BadRequest("corps trop gros");
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
      await auth(["app"]);
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
    return fail(404, "not_found", "route inconnue");
  } catch (e) {
    if (e instanceof AuthError) return fail(e.status, e.code, e.message);
    if (e instanceof BadRequest) return fail(400, "bad_request", e.message);
    console.error(JSON.stringify({ api_error: e instanceof Error ? e.name + ": " + e.message : "unknown", path }));
    return fail(500, "internal", "erreur interne");
  }
}
