/** Small typed helpers over D1: kv_state, config, alerts. */

export async function kvGet<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM kv_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export function kvPut(db: D1Database, key: string, value: unknown, now: number): D1PreparedStatement {
  return db
    .prepare("INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), now);
}

/** Insert only if absent. Resolves true if this call created it (atomic one-time markers). */
export async function kvCreate(db: D1Database, key: string, value: unknown, now: number): Promise<boolean> {
  const res = await db
    .prepare("INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(key, JSON.stringify(value), now)
    .run();
  return res.meta.changes === 1;
}

export async function configGet<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM config WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export function configPut(db: D1Database, key: string, value: unknown, now: number): D1PreparedStatement {
  return db
    .prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), now);
}

export type AlertLevel = "info" | "warn" | "critical";

/**
 * An alert, kept once per dedupe key (by default: source, code and New York
 * day), so a problem that lasts all session raises one alert, not 400.
 */
export function alert(db: D1Database, now: number, level: AlertLevel, source: string, code: string, message: string, dedupeKey: string | null): D1PreparedStatement {
  return db
    .prepare("INSERT INTO alerts (ts, level, source, code, message, dedupe_key) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
    .bind(now, level, source, code, message.slice(0, 500), dedupeKey);
}
