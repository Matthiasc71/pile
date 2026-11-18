/** Historique (brief 8.1 §3). Trades arrive with milestone 5; until then an honest empty state. */
import { useEffect, useState } from "preact/hooks";
import { api, type Trade } from "../api";
import { eur, when } from "../format";
import { link } from "../router";
import { BackIcon } from "../ui/icons";

export function BackLink() {
  return (
    <a {...link("tableau")} class="back" aria-label="Retour au tableau de bord">
      <BackIcon />
      TABLEAU
    </a>
  );
}

const REASONS: Record<string, string> = { target: "objectif", stop: "stop", flat: "clôture", kill: "coupure" };

export function History({ now }: { now: number }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.trades().then(
      (r) => setTrades(r.trades),
      (e: unknown) => setError(e instanceof Error ? e.message : "erreur"),
    );
  }, []);

  return (
    <main class="screen fade-in">
      <div class="top">
        <BackLink />
      </div>
      <h1 class="page-title">HISTORIQUE</h1>

      <dl class="figures">
        <div>
          <dt class="label">Réussite</dt>
          <dd class="figure-v">—</dd>
          <dd class="figure-g">fantôme —</dd>
        </div>
        <div>
          <dt class="label">R moyen</dt>
          <dd class="figure-v">—</dd>
          <dd class="figure-g">fantôme —</dd>
        </div>
        <div>
          <dt class="label">Glissement</dt>
          <dd class="figure-v">—</dd>
          <dd class="figure-g">fantôme —</dd>
        </div>
      </dl>

      <section class="section" aria-label="Trades">
        {error ? <p class="error">Historique indisponible : {error}</p> : null}
        {trades === null && !error ? <p class="empty">Chargement…</p> : null}
        {trades && trades.length === 0 ? (
          <p class="empty">
            Aucun trade pour l'instant. Les achats et ventes de Claude s'afficheront ici, groupés par jour, avec l'heure, le résultat et la raison. Les jours sans trade sont normaux : un trade n'est armé que si la Time Machine le
            soutient.
          </p>
        ) : null}
        <ul>
          {(trades ?? []).map((t) => (
            <li key={t.id} class="row">
              <span class="row-main">
                <span class="row-title">{t.symbol}</span>
                <span class="row-sub">
                  {when(t.entry_at, now)}
                  {t.exit_at ? " → " + when(t.exit_at, now) : ""}
                  {t.exit_reason ? " · " + (REASONS[t.exit_reason] ?? t.exit_reason) : ""}
                </span>
              </span>
              {t.pnl_eur !== null ? <span class={"row-value " + (t.pnl_eur < 0 ? "loss" : "gain")}>{eur(t.pnl_eur, true)}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
