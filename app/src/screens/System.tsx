/** Système et réglages (brief 8.1 §4). */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, type Health, type State } from "../api";
import { ago, day, eur, hhmm, usd } from "../format";
import type { Live } from "../live";
import { splitChange } from "../money";
import { HoldButton } from "../ui/HoldButton";
import { PauseIcon, PlayIcon } from "../ui/icons";
import { BackLink } from "./History";

const PASS_NAMES: Record<string, string> = {
  "avant-ouverture": "Avant l'ouverture",
  cassures: "Cassures",
  "mi-seance": "Mi-séance",
  bilan: "Bilan",
};

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  const id = "h-" + title.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <section class="section" aria-labelledby={id}>
      <div class="section-head">
        <h2 id={id} class="label">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Kv({ k, v, cls }: { k: string; v: ComponentChildren; cls?: string }) {
  return (
    <div class="kv">
      <span>{k}</span>
      <span class={cls}>{v}</span>
    </div>
  );
}

function healthText(h: Health | null, now: number): { text: string; cls: string } {
  if (!h) return { text: "pas encore de nouvelles", cls: "muted" };
  if (!h.ok) return { text: "en panne" + (h.code ? " (" + h.code + ")" : "") + (h.at ? " · " + ago(h.at, now) : ""), cls: "loss" };
  return { text: "ok · " + ago(h.at, now), cls: "ok" };
}

function Controls({ live }: { live: Live }) {
  const s = live.state;
  const paused = !!s?.paused.active;
  const [busy, setBusy] = useState(false);
  const [killMsg, setKillMsg] = useState<string | null>(null);
  const togglePause = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const r = await api.pause(!paused);
      live.setState({ ...s, paused: r.paused });
    } finally {
      setBusy(false);
    }
  };
  const kill = async () => {
    setKillMsg("Coupure en cours…");
    try {
      const r = await api.kill();
      if (r.guard !== "ok") setKillMsg("Pause activée. Compte refusé par le contrôle paper (" + r.guard + ") : rien n'a été touché.");
      else if (r.errors.length) setKillMsg("Pause activée, coupure incomplète : " + r.errors.join(" ; ") + ". Alerte envoyée.");
      else setKillMsg("Pause activée. " + r.cancelled_orders + " ordre(s) annulé(s), " + r.closed_positions + " position(s) fermée(s).");
    } catch (e) {
      setKillMsg("Échec de la coupure : " + (e instanceof Error ? e.message : "erreur") + ". Réessaie, ou ferme les positions dans Alpaca.");
    }
    live.refresh();
  };
  return (
    <Section title="Contrôle">
      <div class="controls">
        <button type="button" class="wide-btn" disabled={!s || busy} onClick={togglePause}>
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? "Reprendre les nouvelles entrées" : "Mettre en pause"}
        </button>
        <HoldButton label="Tout couper" doneLabel="Coupé" onDone={kill} disabled={!s} />
      </div>
      <p class="note">
        {paused ? "En pause" + (s?.paused.reason ? " (" + s.paused.reason + ")" : "") + " : aucune nouvelle entrée. Les positions ouvertes restent protégées et sortent normalement." : "La pause bloque toute nouvelle entrée, du veilleur comme de Claude. Tout couper annule les ordres, ferme les positions au marché, puis met en pause."}
      </p>
      {killMsg ? (
        <p class="note" role="status">
          {killMsg}
        </p>
      ) : null}
    </Section>
  );
}

function Notifications() {
  const items = ["Chaque achat et vente", "Bilan du soir", "Alertes de sécurité"];
  return (
    <Section title="Notifications">
      {items.map((k) => (
        <label key={k} class="switch">
          <span>{k}</span>
          <input type="checkbox" role="switch" checked={false} disabled aria-describedby="notif-soon" />
        </label>
      ))}
      <p id="notif-soon" class="note">
        Bientôt : les notifications arrivent avec une prochaine version. Il faudra que Pile soit ajoutée à l'écran d'accueil.
      </p>
    </Section>
  );
}

function Limits({ s }: { s: State }) {
  const l = s.limits;
  const rate = s.money?.fx.eur_per_usd ?? null;
  const both = (v: number) => usd(v) + (rate ? " · " + eur(v * rate) : "");
  return (
    <Section title="Limites de risque">
      {l ? (
        <>
          <Kv k="Perte max par trade" v={both(l.max_loss_trade_usd)} />
          <Kv k="Perte max du jour" v={both(l.max_daily_loss_usd)} />
          <Kv k="Trades par jour" v={String(l.max_trades)} />
          <Kv k="Position max" v={both(l.max_position_usd)} />
          <Kv k="Toujours en liquide" v={both(l.cash_buffer_usd)} />
          <p class="note">1 % par trade, 3 % par jour, 3 trades : les proportions conseillées par le skill, recalculées sur le capital. Lecture seule.</p>
        </>
      ) : (
        <p class="empty">Disponibles dès le premier point de capital.</p>
      )}
    </Section>
  );
}

function Passes({ s }: { s: State }) {
  const first = s.passes[0];
  return (
    <Section title={"Passages de Claude" + (first ? " · " + day(first.at) : "")}>
      {s.passes.length ? s.passes.map((p) => <Kv key={p.name} k={PASS_NAMES[p.name] ?? p.name} v={hhmm(p.at)} cls={p.at < s.now ? "muted" : undefined} />) : <p class="empty">Horaires connus dès que le veilleur a lu l'horloge de la bourse.</p>}
      <p class="note">Heure de Paris, calculée depuis New York : l'écart passe à 5 h quelques semaines par an.</p>
    </Section>
  );
}

function HealthSection({ s }: { s: State }) {
  const h = s.health;
  const tickAge = h.last_tick ? s.now - h.last_tick : null;
  const tickBad = !!s.session?.open && (tickAge === null || tickAge > 5 * 60_000);
  const fx = h.fx;
  const fxT = healthText(fx, s.now);
  return (
    <Section title="Santé">
      <Kv k="Veilleur, dernier tick" v={ago(h.last_tick, s.now)} cls={tickBad ? "loss" : h.last_tick ? "ok" : "muted"} />
      <Kv k="Passage de Claude" v={h.last_claude_pass ? ago(h.last_claude_pass.at, s.now) : "aucun pour l'instant"} cls="muted" />
      <Kv k="Alpaca" v={healthText(h.alpaca, s.now).text} cls={healthText(h.alpaca, s.now).cls} />
      <Kv k="Données de marché" v={healthText(h.data, s.now).text} cls={healthText(h.data, s.now).cls} />
      <Kv k="Change BCE" v={fx?.rate_date && s.money ? "1 $ = " + s.money.fx.eur_per_usd.toLocaleString("fr-FR", { maximumFractionDigits: 5 }) + " € · " + fx.rate_date.slice(8, 10) + "/" + fx.rate_date.slice(5, 7) : fxT.text} cls={fx?.ok === false ? "loss" : undefined} />
      {s.alerts_open ? <Kv k="Alertes ouvertes" v={String(s.alerts_open)} cls="warn" /> : null}
    </Section>
  );
}

function FxSplit({ s }: { s: State }) {
  const m = s.money;
  const d0 = s.day0;
  if (!m || !d0) return null;
  const split = splitChange(m.usd, m.fx.eur_per_usd, d0.usd, d0.eur_per_usd, m.base_eur);
  const cls = (v: number) => (v < -0.004 ? "loss" : v > 0.004 ? "gain" : "muted");
  return (
    <Section title="D'où vient l'écart">
      <Kv k="Écart avec les 50 €" v={eur(split.total, true)} cls={cls(split.total)} />
      <Kv k="Dû aux trades" v={eur(split.trades, true)} cls={cls(split.trades)} />
      <Kv k="Dû au change" v={eur(split.fx, true)} cls={cls(split.fx)} />
      <Kv k="Arrondi du dépôt" v={eur(split.deposit, true)} cls={cls(split.deposit)} />
      <p class="note">
        Le compte vit en dollars. Au jour 0 ({d0.date}), {usd(d0.usd)} au taux de {d0.eur_per_usd.toLocaleString("fr-FR")} € pour 1 $. Si l'euro bouge, ta courbe en euros bouge aussi, même sans aucun trade.
      </p>
    </Section>
  );
}

function Pairing() {
  const [code, setCode] = useState<{ code: string; expires_at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [code]);
  const left = code ? Math.max(0, Math.round((code.expires_at - now) / 1000)) : 0;
  const make = async () => {
    setErr(null);
    try {
      setCode(await api.pairCode());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erreur");
    }
  };
  return (
    <Section title="Appareils">
      {code && left > 0 ? (
        <>
          <p class="code" aria-label={"Code d'appairage " + code.code.split("").join(" ")}>
            {code.code.slice(0, 4)} {code.code.slice(4)}
          </p>
          <p class="note" role="timer">
            À taper dans Pile sur le nouvel appareil, dans les {Math.floor(left / 60)} min {String(left % 60).padStart(2, "0")} s. Valable une fois.
          </p>
        </>
      ) : (
        <button type="button" class="wide-btn" onClick={make}>
          Appairer un nouvel appareil
        </button>
      )}
      {err ? <p class="error">{err}</p> : null}
    </Section>
  );
}

function ClaudeToken() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const make = async () => {
    setErr(null);
    try {
      setToken((await api.claudeToken()).token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erreur");
    }
  };
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setErr("Copie impossible : sélectionne le jeton à la main.");
    }
  };
  return (
    <Section title="Jeton de Claude">
      {token ? (
        <>
          <p class="token" aria-label="Jeton de Claude">
            {token}
          </p>
          <div class="controls">
            <button type="button" class="wide-btn" onClick={copy}>
              {copied ? "Copié" : "Copier le jeton"}
            </button>
          </div>
          <p class="note">Affiché une seule fois. Colle-le uniquement dans le formulaire sécurisé que Claude t'ouvre, jamais dans la conversation. Il ne permet que de lire l'état et d'envoyer des plans : pas de pause, pas de coupure, pas d'ordre.</p>
        </>
      ) : (
        <>
          <button type="button" class="wide-btn" onClick={make}>
            Créer le jeton de Claude
          </button>
          <p class="note">Pour les 4 passages planifiés. Un nouveau jeton n'annule pas l'ancien : révoque-le si besoin.</p>
        </>
      )}
      {err ? <p class="error">{err}</p> : null}
    </Section>
  );
}

function Honesty() {
  return (
    <Section title="À garder en tête">
      <ul class="note list">
        <li>Pile est un banc d'essai éducatif sur un compte paper (argent fictif). Rien ici n'est un conseil financier.</li>
        <li>Le paper exécute souvent mieux que le réel : le glissement modélisé atténue ce biais sans le supprimer.</li>
        <li>Entre deux passages de Claude, seul le veilleur agit, et il n'exécute que des plans déjà validés.</li>
        <li>L'indice de foule est une estimation.</li>
      </ul>
    </Section>
  );
}

export function System({ live }: { live: Live }) {
  const s = live.state;
  return (
    <main class="screen fade-in">
      <div class="top">
        <BackLink />
      </div>
      <h1 class="page-title">SYSTÈME</h1>
      <Controls live={live} />
      {s ? (
        <>
          <HealthSection s={s} />
          <Passes s={s} />
          <Limits s={s} />
          <FxSplit s={s} />
        </>
      ) : (
        <p class="empty">Chargement de l'état du veilleur…</p>
      )}
      <Notifications />
      <Pairing />
      <ClaudeToken />
      <Honesty />
    </main>
  );
}
