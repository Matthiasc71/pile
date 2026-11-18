/**
 * "Tout couper" (section 6.3): pause first, then cancel every open order and
 * close every position at market. Exits are never blocked by a limit, but
 * nothing is touched on an account the paper guard refuses: closing someone
 * else's positions would be the worst possible bug.
 */
import { trading, type AlpacaKeys, type Fetcher } from "./alpaca";
import type { Deps, Env } from "./env";
import { checkAccount } from "./guard";
import { alert, configGet, kvPut } from "./store";
import type { Day0 } from "./tick";
import { NY, zoned } from "./time";

export interface KillResult {
  readonly paused: true;
  readonly guard: "ok" | string;
  readonly cancelled_orders: number;
  readonly closed_positions: number;
  readonly errors: string[];
}

export async function killAll(env: Env, deps: Deps, now: number, by: string): Promise<KillResult> {
  const db = env.DB;
  const day = zoned(now, NY).date;
  // 1. Pause, whatever happens next (no new entry, from the watcher or Claude).
  await db.batch([
    kvPut(db, "pause", { active: true, reason: "tout couper (" + by + ")", since: now, until: null }, now),
    alert(db, now, "critical", "app", "kill", "Tout couper demandé par " + by + ".", null),
  ]);

  const result = { paused: true as const, guard: "ok", cancelled_orders: 0, closed_positions: 0, errors: [] as string[] };
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) {
    result.guard = "keys_missing";
    return result;
  }
  const keys: AlpacaKeys = { keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY };
  const fetcher: Fetcher = (input, init) => deps.fetch(input, init);

  // 2. Same guard as every minute.
  const day0 = await configGet<Day0>(db, "day0");
  const verdict = checkAccount(await trading(fetcher, keys, "GET", "/v2/account"), day0?.accountId ?? null);
  if (!verdict.ok) {
    result.guard = verdict.code;
    await alert(db, now, "critical", "app", "kill_refused", "Tout couper : compte refusé (" + verdict.message + "), rien n'a été touché.", "kill_refused:" + day).run();
    return result;
  }

  // 3. Cancel orders first (a stop holds the shares), then close positions.
  try {
    const cancelled = await trading(fetcher, keys, "DELETE", "/v2/orders");
    result.cancelled_orders = Array.isArray(cancelled) ? cancelled.length : 0;
  } catch (e) {
    result.errors.push("annulation des ordres : " + (e instanceof Error ? e.message : "erreur"));
  }
  try {
    const closed = await trading(fetcher, keys, "DELETE", "/v2/positions?cancel_orders=true");
    result.closed_positions = Array.isArray(closed) ? closed.length : 0;
  } catch (e) {
    result.errors.push("fermeture des positions : " + (e instanceof Error ? e.message : "erreur"));
  }
  if (result.errors.length) {
    await alert(db, now, "critical", "app", "kill_partial", "Tout couper incomplet : " + result.errors.join(" ; "), null).run();
  }
  return result;
}
