#!/usr/bin/env node
// CI only, after a deploy: a read-only health summary of the live watcher.
// The repository is public, so this prints nothing identifying: no account id
// or number, no token, no device name. Counts, times, codes and amounts only.
//
//   node scripts/ci_status.mjs d1              # D1 summary
//   node scripts/ci_status.mjs tail FILE       # summarize `wrangler tail --format json` output
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "..", "worker");

function query(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "pile", "--remote", "--json", "--command", sql], {
    cwd: WORKER,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).results ?? [];
}

const iso = (ms) => (ms ? new Date(ms).toISOString().replace(".000Z", "Z") : "—");

function d1() {
  const kv = Object.fromEntries(
    query("SELECT key, value FROM kv_state WHERE key IN ('last_tick','health_alpaca','health_data','health_fx','last_open_date','clock','pause','positions')").map((r) => [r.key, JSON.parse(r.value)]),
  );
  const eq = query("SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM equity_points")[0] ?? {};
  const lastEq = query("SELECT ts, equity_usd FROM equity_points ORDER BY ts DESC LIMIT 1")[0];
  const spy = query("SELECT COUNT(*) AS n, MAX(ts) AS last FROM spy_points")[0] ?? {};
  const bars = query("SELECT COUNT(*) AS n FROM bars_1m")[0] ?? {};
  const fx = query("SELECT date, eur_per_usd FROM fx_rates ORDER BY date DESC LIMIT 3");
  const day0Row = query("SELECT value FROM config WHERE key = 'day0'")[0];
  const devices = query("SELECT scope, COUNT(*) AS n FROM devices WHERE revoked_at IS NULL GROUP BY scope");
  const alerts = query("SELECT ts, level, code FROM alerts ORDER BY id DESC LIMIT 10");
  const migrations = query("SELECT name FROM d1_migrations ORDER BY id").map((r) => r.name);

  const lines = [];
  lines.push("## Veilleur : état D1");
  lines.push("- migrations : " + (migrations.join(", ") || "aucune"));
  lines.push("- dernier tick : " + iso(kv.last_tick?.at) + (kv.last_tick?.error ? " — ÉCHEC " + kv.last_tick.error + " : " + kv.last_tick.message : ""));
  lines.push("- horloge : " + (kv.clock ? (kv.clock.isOpen ? "ouvert" : "fermé") + ", prochaine ouverture " + iso(kv.clock.nextOpen) + ", fermeture " + iso(kv.clock.nextClose) : "—"));
  for (const h of ["health_alpaca", "health_data", "health_fx"]) {
    const v = kv[h];
    lines.push("- " + h + " : " + (v ? (v.ok ? "ok" : "KO " + (v.code ?? "")) + " à " + iso(v.at) : "—"));
  }
  if (day0Row) {
    const d = JSON.parse(day0Row.value);
    lines.push(
      "- jour 0 : " + d.date + " à " + iso(d.ts) + ", " + d.equityUsd + " $, taux BCE " + d.eurPerUsd + " (" + d.fxDate + "), base " + d.baseEur + " €, SPY " + d.spyPrice +
        ", compte épinglé : " + (d.accountId ? "oui" : "non"),
    );
  } else {
    lines.push("- jour 0 : pas encore enregistré");
  }
  lines.push("- points de capital : " + eq.n + " (" + iso(eq.first) + " → " + iso(eq.last) + ")" + (lastEq ? ", dernier " + lastEq.equity_usd + " $" : ""));
  lines.push("- points S&P : " + spy.n + ", barres 1 min : " + bars.n);
  lines.push("- taux BCE : " + (fx.map((r) => r.date + " " + r.eur_per_usd).join(", ") || "—"));
  lines.push("- positions : " + (kv.positions?.items?.length ?? 0) + ", pause : " + (kv.pause?.active ? "oui" : "non"));
  lines.push("- appareils : " + (devices.map((r) => r.scope + " " + r.n).join(", ") || "aucun"));
  lines.push("- alertes récentes : " + (alerts.map((a) => iso(a.ts) + " " + a.level + " " + a.code).join(" | ") || "aucune"));
  return lines.join("\n");
}

// `wrangler tail --format json` prints a stream of JSON objects (possibly pretty-printed).
function parseStream(text) {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* ignore a partial object */
        }
        start = -1;
      }
    }
  }
  return values;
}

function tail(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "## Mesure CPU\n- pas de sortie de wrangler tail";
  }
  const events = parseStream(text).filter((e) => e && e.event && "cron" in e.event);
  const lines = ["## Mesure CPU (événements cron capturés : " + events.length + ")"];
  for (const e of events) {
    const tick = (e.logs ?? []).map((l) => (Array.isArray(l.message) ? l.message.join(" ") : String(l.message))).find((m) => m.includes('"tick"')) ?? "";
    lines.push(
      "- " + iso(e.event.scheduledTime) + " : " + e.outcome + ", CPU " + (e.cpuTime ?? "?") + " ms, durée " + (e.wallTime ?? "?") + " ms" + (tick ? ", " + tick : "") +
        ((e.exceptions ?? []).length ? ", exception : " + e.exceptions.map((x) => x.name).join(",") : ""),
    );
  }
  return lines.join("\n");
}

const mode = process.argv[2];
const out = mode === "tail" ? tail(process.argv[3]) : d1();
console.log(out);
