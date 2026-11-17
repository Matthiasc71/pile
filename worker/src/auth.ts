/**
 * API tokens and pairing.
 *
 * - A token is 32 random bytes (base64url) with a "pile_" prefix, shown once.
 *   D1 stores only HMAC-SHA256(TOKEN_PEPPER, token): a copy of the database
 *   alone cannot check or forge a token.
 * - Two scopes: "app" (the owner's phone and computer) and "claude" (the
 *   scheduled passes).
 * - First pairing: the PAIR_BOOTSTRAP secret, typed once in the installed
 *   PWA. Its hash is then marked consumed, so it works once even while it
 *   stays in the secrets (setting a new value re-enables it once).
 * - Next pairings: an 8-character code created from an already paired app,
 *   valid 10 minutes, single use.
 * - /api/pair: 5 failures, then 15 minutes locked.
 */
import type { Env } from "./env";
import { kvCreate, kvGet, kvPut } from "./store";

export type Scope = "app" | "claude";

export interface Device {
  readonly id: string;
  readonly scope: Scope;
  readonly name: string;
}

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(pepper: string): Promise<CryptoKey> {
  let k = keyCache.get(pepper);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(pepper, k);
  }
  return k;
}

export async function hashSecret(pepper: string, value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(pepper), enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newToken(): string {
  return "pile_" + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

// Crockford base32 without I, L, O, U: easy to read and type on a phone.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newPairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b & 31];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export class AuthError extends Error {
  override readonly name = "AuthError";
  constructor(
    readonly status: 401 | 403 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The device behind a Bearer token, if it has one of the allowed scopes. */
export async function authenticate(env: Env, request: Request, allowed: readonly Scope[], now: number): Promise<Device> {
  if (!env.TOKEN_PEPPER) throw new AuthError(503, "not_configured", "TOKEN_PEPPER manquant");
  const header = request.headers.get("Authorization") ?? "";
  const m = /^Bearer (pile_[A-Za-z0-9_-]{43})$/.exec(header);
  if (!m) throw new AuthError(401, "unauthorized", "jeton manquant ou mal formé");
  const hash = await hashSecret(env.TOKEN_PEPPER, m[1] as string);
  const row = await env.DB.prepare("SELECT id, scope, name, last_seen_at FROM devices WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(hash)
    .first<{ id: string; scope: Scope; name: string; last_seen_at: number | null }>();
  if (!row) throw new AuthError(401, "unauthorized", "jeton inconnu ou révoqué");
  if (!allowed.includes(row.scope)) throw new AuthError(403, "forbidden", "portée insuffisante");
  if (row.last_seen_at === null || now - row.last_seen_at > 5 * 60_000) {
    await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
  }
  return { id: row.id, scope: row.scope, name: row.name };
}

/** Create a device and return its token (the only time it exists in clear). */
export async function issueToken(env: Env, scope: Scope, name: string, now: number): Promise<{ id: string; token: string }> {
  if (!env.TOKEN_PEPPER) throw new AuthError(503, "not_configured", "TOKEN_PEPPER manquant");
  const token = newToken();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO devices (id, token_hash, scope, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, await hashSecret(env.TOKEN_PEPPER, token), scope, name.slice(0, 60), now)
    .run();
  return { id, token };
}

export const PAIR_CODE_TTL_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const BOOTSTRAP_MIN_LENGTH = 16;

export async function createPairCode(env: Env, createdBy: string, now: number): Promise<{ code: string; expiresAt: number }> {
  if (!env.TOKEN_PEPPER) throw new AuthError(503, "not_configured", "TOKEN_PEPPER manquant");
  const code = newPairCode();
  const expiresAt = now + PAIR_CODE_TTL_MS;
  await env.DB.prepare("INSERT INTO pair_codes (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashSecret(env.TOKEN_PEPPER, "code:" + code), createdBy, now, expiresAt)
    .run();
  return { code, expiresAt };
}

interface Failures {
  readonly count: number;
  readonly since: number;
}

/** Exchange a pairing code or the bootstrap passphrase for an app token. */
export async function pair(env: Env, rawCode: string, name: string, now: number): Promise<{ id: string; token: string }> {
  if (!env.TOKEN_PEPPER) throw new AuthError(503, "not_configured", "TOKEN_PEPPER manquant");
  const db = env.DB;
  const failures = await kvGet<Failures>(db, "pair_failures");
  if (failures && failures.count >= MAX_FAILURES && now - failures.since < LOCK_MS) {
    throw new AuthError(429, "locked", "trop d'essais, réessaie dans 15 minutes");
  }

  let accepted = false;
  // 1. The bootstrap passphrase, once per value.
  if (env.PAIR_BOOTSTRAP && env.PAIR_BOOTSTRAP.length >= BOOTSTRAP_MIN_LENGTH && rawCode.length >= BOOTSTRAP_MIN_LENGTH) {
    const given = await hashSecret(env.TOKEN_PEPPER, "bootstrap:" + rawCode);
    const expected = await hashSecret(env.TOKEN_PEPPER, "bootstrap:" + env.PAIR_BOOTSTRAP);
    if (given === expected) {
      accepted = await kvCreate(db, "bootstrap_used:" + expected, { at: now }, now);
    }
  }
  // 2. A one-time code.
  if (!accepted) {
    const code = normalizeCode(rawCode);
    if (/^[0-9A-Z]{8}$/.test(code)) {
      const res = await db
        .prepare("UPDATE pair_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?")
        .bind(now, await hashSecret(env.TOKEN_PEPPER, "code:" + code), now)
        .run();
      accepted = res.meta.changes === 1;
    }
  }

  if (!accepted) {
    const fresh = !failures || now - failures.since >= LOCK_MS;
    await kvPut(db, "pair_failures", { count: fresh ? 1 : (failures as Failures).count + 1, since: fresh ? now : (failures as Failures).since }, now).run();
    throw new AuthError(401, "bad_code", "code invalide, expiré ou déjà utilisé");
  }
  await db.prepare("DELETE FROM kv_state WHERE key = 'pair_failures'").run();
  return issueToken(env, "app", name || "appareil", now);
}
