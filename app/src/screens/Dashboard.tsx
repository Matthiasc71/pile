/** Tableau de bord (brief 8.1, mockup Oscillo-Prism-Tableau.html). */
import { useEffect, useRef, useState } from "preact/hooks";
import { api, type Range, type State } from "../api";
import { eur, hhmm, pct, when } from "../format";
import type { Live } from "../live";
import { link } from "../router";
import { Scope, type Cursor } from "../scope/Scope";
import { CrowdBars, LiveDot, PauseIcon, PlayIcon } from "../ui/icons";

const RANGES: { id: Range; label: string; full: string }[] = [
  { id: "1j", label: "1J", full: "un jour" },
  { id: "1s", label: "1S", full: "une semaine" },
  { id: "1m", label: "1M", full: "un mois" },
  { id: "tout", label: "Tout", full: "depuis le départ" },
];

export function Header({ live }: { live: Live }) {
  const s = live.state;
  const [busy, setBusy] = useState(false);
  const paused = !!s?.paused.active;
  const toggle = async () => {
    if (!s || busy) return;
    setBusy(true);
    try {
      const r = await api.pause(!paused);
      live.setState({ ...s, paused: r.paused });
    } catch {
      live.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <header class="top">
      <h1 class="brand">
        <span class="prism">PILE</span>
        <span class="label">Paper</span>
      </h1>
      <div class="top-right">
        <LiveDot open={!!s?.session?.open} />
        <button type="button" class="icon-btn" aria-pressed={paused} aria-label={paused ? "Reprendre les nouvelles entrées" : "Mettre en pause"} disabled={!s || busy} onClick={toggle}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
      </div>
    </header>
  );
}

function Hero({ live, cursor }: { live: Live; cursor: Cursor | null }) {
  const m = live.state?.money;
  const shown = cursor?.toi ?? m?.eur ?? null;
  const base = m?.base_eur ?? 50;
  const delta = shown === null ? null : shown - base;
  const neg = delta !== null && delta < -0.004;

  // Brief phosphor flash (200 ms) when the value changes.
  const [flash, setFlash] = useState(false);
  const prev = useRef(m?.eur);
  useEffect(() => {
    if (prev.current !== undefined && m?.eur !== undefined && m.eur !== prev.current) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 200);
      prev.current = m.eur;
      return () => window.clearTimeout(t);
    }
    prev.current = m?.eur;
    return undefined;
  }, [m?.eur]);

  return (
    <div class="hero">
      <p class={"hero-value" + (neg ? " neg" : "") + (flash ? " flash" : "")} aria-live="polite">
        {shown === null ? "— €" : eur(shown)}
      </p>
      <p class={"hero-delta " + (delta === null ? "muted" : neg ? "loss" : "gain")}>
        {delta === null ? "en attente du premier point" : eur(delta, true) + " · " + pct((delta / base) * 100)}
      </p>
    </div>
  );
}

function StatusLine({ live }: { live: Live }) {
  const s = live.state;
  const parts: string[] = [];
  if (s?.paused.active) parts.push("En pause : aucune nouvelle entrée");
  if (live.offline && live.at) parts.push("Hors ligne · état de " + hhmm(live.at));
  else if (live.error) parts.push("Veilleur injoignable · " + live.error);
  else if (s && !s.session?.open && s.session) parts.push("Séance fermée · ouverture " + when(s.session.next_open, s.now));
  return <p class="status-line">{parts.join(" · ")}</p>;
}

function Legend({ cursor, now }: { cursor: Cursor | null; now: number }) {
  if (cursor) {
    return (
      <p class="legend" aria-live="polite">
        <span>
          <span class="ch gain">1</span>
          {cursor.toi === null ? "—" : eur(cursor.toi)}
        </span>
        <span>
          <span class="ch warn">2</span>
          {cursor.sp === null ? "—" : eur(cursor.sp)}
        </span>
        <span class="time">{when(cursor.t, now)}</span>
      </p>
    );
  }
  return (
    <p class="legend">
      <span>
        <span class="ch gain">1</span>toi
      </span>
      <span>
        <span class="ch warn">2</span>
        S&amp;P
      </span>
      <span>
        <span class="ch">3</span>fantôme
      </span>
    </p>
  );
}

function Position({ state }: { state: State }) {
  const p = state.positions[0];
  if (!p) return null;
  const rate = state.money?.fx.eur_per_usd ?? 0;
  const pl = p.unrealizedPl * rate;
  const gauge = p.stop !== undefined && p.target !== undefined && p.target > p.stop ? Math.min(1, Math.max(0, (p.currentPrice - p.stop) / (p.target - p.stop))) : null;
  return (
    <section class="section" aria-label="Position ouverte">
      <div class="row">
        <span class="row-main">
          <span class="row-title">{p.symbol}</span>
          <span class="row-sub">{p.qty.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} action · ouverte</span>
        </span>
        {gauge !== null ? (
          <svg class="gauge" role="img" aria-label={"Prix à " + Math.round(gauge * 100) + " % du chemin entre le stop et l'objectif"} viewBox="0 0 96 10">
            <line x1="0" y1="5" x2="96" y2="5" stroke="rgba(120,242,156,.28)" />
            <line x1="0" y1="1" x2="0" y2="9" stroke="#F2876E" />
            <line x1="96" y1="1" x2="96" y2="9" stroke="#78F29C" />
            <circle cx={gauge * 96} cy="5" r="3" fill="#CFF7DA" />
          </svg>
        ) : null}
        <span class={"row-value " + (pl < 0 ? "loss" : "gain")}>{eur(pl, true)}</span>
      </div>
    </section>
  );
}

export function Dashboard({ live }: { live: Live }) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const s = live.state;
  const now = s?.now ?? Date.now();
  const historique = link("historique");
  const systeme = link("systeme");
  return (
    <main class="screen fade-in">
      <Header live={live} />
      <Hero live={live} cursor={cursor} />
      <StatusLine live={live} />

      <figure class="scope-block">
        <div class="ranges" role="group" aria-label="Période de la courbe">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={live.range === r.id} aria-label={"Courbe sur " + r.full} onClick={() => live.setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <Scope series={live.series} base={s?.money?.base_eur ?? 50} onCursor={setCursor} />
        <figcaption>
          <Legend cursor={cursor} now={now} />
        </figcaption>
      </figure>

      {s ? <Position state={s} /> : null}

      <section class="section" aria-labelledby="h-historique">
        <div class="section-head">
          <h2 id="h-historique" class="label">
            Historique
          </h2>
          <a {...historique} aria-label="Tout l'historique">
            tout
          </a>
        </div>
        <p class="empty">Aucun achat ni vente pour l'instant. Chaque trade de Claude apparaîtra ici, avec sa raison.</p>
      </section>

      <footer class="foot">
        <a {...systeme} class="foot-btn" aria-label={"Système et réglages. Prochain passage de Claude : " + (s?.next_pass ? hhmm(s.next_pass.at) : "inconnu")}>
          <span>CLAUDE {s?.next_pass ? hhmm(s.next_pass.at) : "—"}</span>
          <span class="crowd">
            FOULE <CrowdBars score={s?.crowd?.score ?? null} />
          </span>
        </a>
      </footer>
    </main>
  );
}
