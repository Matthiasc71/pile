/**
 * What Claude's passes send (brief 5.6), validated before anything is stored.
 * The watcher re-checks the same rules here as a second line, on top of the
 * pass's own trader-risk PASS: a plan that breaks one is refused and alerted.
 * Milestone 4 stores and shows plans; milestone 5 executes the real ones.
 */
import * as z from "zod/mini";
import { alert } from "./store";

export const PASS_NAMES = ["avant-ouverture", "cassures", "mi-seance", "bilan"] as const;

const hhmm = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));
const price = z.number().check(z.positive(), z.lt(100_000));
const unit = z.number().check(z.gte(0), z.lte(1));

export const TimeMachineSchema = z.object({
  verdict: z.string().check(z.maxLength(400)),
  seed: z.number().check(z.int()),
  replays: z.optional(z.number().check(z.int())),
  target_first: unit,
  stop_first: unit,
  neither: z.optional(unit),
  avg_r: z.number(),
  avg_r_after_costs: z.number(),
  history_trades: z.optional(z.number().check(z.int(), z.gte(0))),
  history_avg_r: z.optional(z.number()),
  history_avg_r_after_costs: z.optional(z.number()),
  slippage_pct: z.optional(z.number().check(z.gte(0), z.lte(5))),
});

export const PlanSchema = z.object({
  id: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}-[A-Z][A-Z.]{0,5}-[a-z0-9-]{2,24}$/)),
  kind: z.enum(["reel", "fantome"]),
  symbol: z.string().check(z.regex(/^[A-Z][A-Z.]{0,5}$/)),
  setup: z.enum(["orb15"]),
  or: z.object({ high: price, low: price, mid: price }),
  atr_5m: z.optional(z.number().check(z.gte(0))),
  trigger: z.object({
    type: z.literal("close_above"),
    bar: z.literal("5m"),
    level: price,
    buffer_atr: z.number().check(z.gte(0), z.lte(1)),
    delay_s: z.tuple([z.number().check(z.int(), z.gte(0), z.lte(600)), z.number().check(z.int(), z.gte(0), z.lte(600))]),
  }),
  stop: z.object({ rule: z.string().check(z.maxLength(40)), price }),
  target: z.object({ r: z.number().check(z.gte(0.5), z.lte(5)), price, avoid_round: z.boolean() }),
  size: z.object({ risk_usd: z.number().check(z.positive()), max_notional_usd: z.number().check(z.positive()), whole_shares: z.optional(z.boolean()) }),
  window: z.tuple([hhmm, hhmm]),
  flat_by: hhmm,
  timemachine: z.nullable(TimeMachineSchema),
  risk_pass: z.nullable(z.string().check(z.regex(/^[0-9a-f]{16}$/))),
  crowd_score: z.optional(z.number().check(z.gte(0), z.lte(5))),
  adaptations: z.optional(z.array(z.string().check(z.maxLength(120))).check(z.maxLength(8))),
  why: z.string().check(z.minLength(1), z.maxLength(400)),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlansBody = z.object({
  pass: z.enum(PASS_NAMES),
  date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  generated_at: z.string().check(z.maxLength(40)),
  equity_usd: z.number().check(z.positive()),
  limits: z.object({
    max_loss_trade_usd: z.number().check(z.positive()),
    max_daily_loss_usd: z.number().check(z.positive()),
    max_trades: z.number().check(z.int(), z.gte(0), z.lte(3)),
  }),
  crowd: z.optional(z.object({ score: z.number().check(z.gte(0), z.lte(5)), components: z.record(z.string(), unit) })),
  plans: z.array(PlanSchema).check(z.maxLength(12)),
  disarm: z.optional(z.array(z.string().check(z.maxLength(60))).check(z.maxLength(12))),
});
export type PlansBody = z.infer<typeof PlansBody>;

const STRICT_VERDICTS = ["Leans toward the target", "Strongly toward the target"];
const CENT = 0.01;

/** The watcher's own check of one plan. Null when it holds. */
export function planProblem(p: Plan, body: PlansBody): string | null {
  if (p.id.slice(0, 10) !== body.date) return "id : la date ne correspond pas";
  if (!p.id.includes("-" + p.symbol + "-")) return "id : le symbole ne correspond pas";
  if (!(p.or.high > p.or.low)) return "fourchette : haut ≤ bas";
  if (p.trigger.level + CENT < p.or.high) return "déclencheur sous le haut de la fourchette";
  if (!(p.stop.price < p.trigger.level - CENT)) return "stop au-dessus de l'entrée";
  if (!(p.target.price > p.trigger.level + CENT)) return "objectif sous l'entrée";
  const risk = p.trigger.level - p.stop.price;
  const rr = (p.target.price - p.trigger.level) / risk;
  if (rr + 1e-6 < 1) return "gain/risque " + rr.toFixed(2) + " sous 1";
  if (p.size.risk_usd > body.limits.max_loss_trade_usd + CENT) return "risque du trade au-dessus de la limite";
  if (p.size.max_notional_usd > body.equity_usd * 0.75 + CENT) return "taille au-dessus de 75 % du capital";
  if (p.window[0] < "09:45" || p.window[1] > "15:30" || p.window[0] >= p.window[1]) return "fenêtre d'entrée hors 9 h 45 – 15 h 30";
  if (p.flat_by > "15:55") return "clôture après 15 h 55";
  if (p.trigger.delay_s[0] > p.trigger.delay_s[1]) return "délai : min > max";
  if (p.kind === "reel") {
    if (!p.risk_pass) return "pas de PASS de trader-risk";
    const tm = p.timemachine;
    if (!tm) return "pas de Time Machine";
    if (!STRICT_VERDICTS.some((v) => tm.verdict.startsWith(v))) return "Time Machine : verdict « " + tm.verdict.split(":")[0] + " » hors filtre strict";
    if (!(tm.avg_r_after_costs > 0)) return "Time Machine : R moyen après glissement ≤ 0 sur les rejeux";
    if (!(tm.history_avg_r_after_costs !== undefined && tm.history_avg_r_after_costs > 0)) return "Time Machine : R moyen après glissement ≤ 0 sur l'historique";
    if (tm.seed !== 19) return "Time Machine : graine différente de 19";
  }
  return null;
}

/** Canonical JSON (sorted keys) of the plan without its risk_pass: the pass is bound to this hash. */
export async function planHash(p: Plan): Promise<string> {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  const { risk_pass: _ignored, ...rest } = p;
  void _ignored;
  const data = new TextEncoder().encode(JSON.stringify(sort(rest)));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PlansResult {
  readonly accepted: string[];
  readonly rejected: { id: string; reason: string }[];
  readonly disarmed: string[];
}

export async function storePlans(db: D1Database, body: PlansBody, now: number, today: string, paused: boolean): Promise<PlansResult> {
  const result: PlansResult = { accepted: [], rejected: [], disarmed: [] };
  if (body.date !== today) {
    for (const p of body.plans) result.rejected.push({ id: p.id, reason: "date " + body.date + " : ce n'est pas aujourd'hui (" + today + ") à New York" });
    return result;
  }
  const existing = await db
    .prepare("SELECT id, kind, status FROM plans WHERE date = ?")
    .bind(today)
    .all<{ id: string; kind: string; status: string }>();
  const byId = new Map(existing.results.map((r) => [r.id, r]));
  const statements: D1PreparedStatement[] = [];

  for (const id of body.disarm ?? []) {
    const row = byId.get(id);
    if (row && row.status === "arme") {
      statements.push(db.prepare("UPDATE plans SET status = 'desarme', updated_at = ? WHERE id = ? AND status = 'arme'").bind(now, id));
      row.status = "desarme";
      result.disarmed.push(id);
    }
  }

  let realArmed = [...byId.values()].filter((r) => r.kind === "reel" && r.status !== "desarme" && r.status !== "expire").length;
  for (const p of body.plans) {
    let reason = planProblem(p, body);
    const prev = byId.get(p.id);
    if (!reason && prev && prev.status !== "arme" && prev.status !== "desarme") reason = "déjà " + prev.status + " : plus modifiable";
    if (!reason && p.kind === "reel" && paused) reason = "pause active : aucune nouvelle entrée";
    const counts = p.kind === "reel" && (!prev || prev.status === "desarme");
    if (!reason && counts && realArmed >= body.limits.max_trades) reason = "déjà " + realArmed + " trade(s) armé(s) aujourd'hui, limite " + body.limits.max_trades;
    if (reason) {
      result.rejected.push({ id: p.id, reason });
      continue;
    }
    if (counts) realArmed++;
    statements.push(
      db
        .prepare(
          "INSERT INTO plans (id, date, kind, symbol, status, pass, plan, plan_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'arme', ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET status = 'arme', pass = excluded.pass, plan = excluded.plan, plan_hash = excluded.plan_hash, updated_at = excluded.updated_at",
        )
        .bind(p.id, today, p.kind, p.symbol, body.pass, JSON.stringify(p), await planHash(p), now, now),
    );
    result.accepted.push(p.id);
  }
  for (const r of result.rejected) {
    statements.push(alert(db, now, "warn", "claude", "plan_refused", "Plan " + r.id + " refusé par le veilleur : " + r.reason + ".", "plan_refused:" + r.id + ":" + body.pass));
  }
  if (statements.length) await db.batch(statements);
  return result;
}

export interface PlanSummary {
  readonly id: string;
  readonly kind: "reel" | "fantome";
  readonly symbol: string;
  readonly status: string;
  readonly level: number;
  readonly stop: number;
  readonly target: number;
  readonly why: string;
  readonly verdict: string | null;
}

export async function plansOf(db: D1Database, date: string): Promise<PlanSummary[]> {
  const rows = await db
    .prepare("SELECT id, kind, symbol, status, plan FROM plans WHERE date = ? ORDER BY kind DESC, created_at")
    .bind(date)
    .all<{ id: string; kind: "reel" | "fantome"; symbol: string; status: string; plan: string }>();
  return rows.results.map((r) => {
    const p = JSON.parse(r.plan) as Plan;
    return { id: r.id, kind: r.kind, symbol: r.symbol, status: r.status, level: p.trigger.level, stop: p.stop.price, target: p.target.price, why: p.why, verdict: p.timemachine?.verdict.split(":")[0] ?? null };
  });
}
