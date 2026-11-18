#!/usr/bin/env python3
"""Pile's pass commands. Read ops/passes/<pass>.md first: it says which to run.

    python3 ops/pile.py etat                      # stop if closed or paused (exit 3)
    python3 ops/pile.py debut|fin|erreur <pass> [texte]
    python3 ops/pile.py avant-ouverture           # scan + news -> dossier
    python3 ops/pile.py surveiller AMD,PLTR --note "…"
    python3 ops/pile.py cassures                  # plans for the watched symbols -> dossier
    python3 ops/pile.py armer AMD="pourquoi…" PLTR="…"
    python3 ops/pile.py mi-seance                 # news on armed plans + waiting candidates
    python3 ops/pile.py desarmer AMD --raison "…"
    python3 ops/pile.py bilan                     # the day's numbers -> dossier
    python3 ops/pile.py ecrire-bilan --titre "…" --texte "…"

Every command prints a short French summary and writes its full dossier to
trader/dossier-<command>.json. Exit codes: 0 ok, 2 error (run `erreur`),
3 nothing to do today (closed or paused: run `fin <pass> --saute`).
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pile_ops import crowd as crowd_mod  # noqa: E402
from pile_ops import rules  # noqa: E402
from pile_ops.api import Api, ApiError  # noqa: E402
from pile_ops.planner import candidate  # noqa: E402
from pile_ops.skill import ROOT, SkillError, fetch_iex_chart, fetch_yahoo_chart, ny_now, run, save_chart  # noqa: E402

WORK = ROOT
TRADER = os.path.join(WORK, "trader")
WATCH_MAX = 6
NEWS_TOP = 20
# trader-news tags that rule a day trade out (brief 5.4), plus 8-K item 4.02 (restatement).
# The exact scanner and news calls of the passes (tested offline in ops/tests).
DAILY_ARGS = ["daily", "--quiet", "--json", "--show", "0"]


def news_args(tickers, hours, sec=True):
    args = ["--tickers"] + list(tickers) + ["--hours", str(hours), "--all", "--dry-run", "--json"]
    return args if sec else args + ["--no-sec"]


BAD_TAGS = {"earnings", "halt", "risk", "restatement"}


def tags_of(items):
    tags = {t for it in items for t in (it.get("tags") or [])}
    if any(it.get("kind") == "filing" and "4.02" in (it.get("items") or []) for it in items):
        tags.add("restatement")
    return tags


def write(name, data):
    os.makedirs(TRADER, exist_ok=True)
    path = os.path.join(TRADER, "dossier-%s.json" % name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False, default=str)
    return path


def say(*lines):
    print("\n".join(str(x) for x in lines))


def api():
    return Api()


def today():
    return ny_now().strftime("%Y-%m-%d")


def prepare(state):
    """trader/config.json scaled to this morning's equity (brief 5.3)."""
    m = state.get("money") or {}
    equity = m.get("usd")
    if not equity:
        raise SkillError("capital inconnu : le veilleur n'a pas encore de point de capital")
    if equity >= 500:
        raise SkillError("capital %.2f $ ≥ 500 $ : ce n'est pas le compte dédié" % equity)
    cfg = rules.skill_config(equity, os.environ.get("SEC_USER_AGENT", ""))
    os.makedirs(TRADER, exist_ok=True)
    with open(os.path.join(TRADER, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=1)
    return cfg, equity, m.get("cash_usd") or equity


# ------------------------------------------------------------ commands

def cmd_etat(a):
    s = api().state()
    ok = s.get("today_is_trading")
    paused = s["paused"]["active"]
    say("Séance : %s · aujourd'hui %s · pause : %s" % ("ouverte" if (s.get("session") or {}).get("open") else "fermée", "jour de bourse" if ok else "pas de bourse", "OUI" if paused else "non"))
    m = s.get("money")
    if m:
        say("Capital : %.2f $ = %.2f € (taux %s) · écart %+.2f €" % (m["usd"], m["eur"], m["fx"]["eur_per_usd"], m["delta_eur"]))
    say("Plans du jour : %d · dernier bilan : %s · santé veilleur : dernier tick %s" % (len(s.get("plans") or []), s.get("last_bilan_date"), s["health"].get("last_tick")))
    write("etat", s)
    if not ok:
        say("→ Pas de bourse aujourd'hui : rien à faire.")
        return 3
    if paused and a.passe not in ("bilan",):
        say("→ Pause active : aucun nouveau plan.")
        return 3
    return 0


def cmd_debut(a):
    api().post_pass(a.passe, "start")
    say("Passage « %s » commencé." % a.passe)
    return 0


def cmd_fin(a):
    api().post_pass(a.passe, "skipped" if a.saute is not None else "done", a.saute)
    say("Passage « %s » terminé%s." % (a.passe, " (sauté : %s)" % a.saute if a.saute else ""))
    return 0


def cmd_erreur(a):
    p = api()
    p.post_pass(a.passe, "error", a.texte)
    say("Erreur signalée : %s. Pas de trade depuis ce passage." % a.texte)
    return 0


def cmd_avant_ouverture(a):
    p = api()
    s = p.state()
    cfg, equity, _ = prepare(s)
    run("scan", ["universe"], WORK, timeout=300)
    code, scan, err = run("scan", DAILY_ARGS, WORK, timeout=1500)
    if not scan:
        raise SkillError("scan : " + err)
    hits = scan.get("hits") or []
    top = hits[:NEWS_TOP]
    tickers = [h["symbol"] for h in top]
    news = {}
    if tickers:
        code, nj, err = run("news", news_args(tickers, 20, bool(os.environ.get("SEC_USER_AGENT"))) + ["--no-moves"], WORK, timeout=900, ok_codes=(0, 1))
        for it in (nj or {}).get("items", []):
            news.setdefault(it.get("ticker"), []).append(it)
    rows = []
    for rank, h in enumerate(top):
        items = news.get(h["symbol"], [])
        tags = sorted(tags_of(items))
        rows.append({"rang": rank, "symbol": h["symbol"], "setups": h.get("setups"), "prix": h.get("price"), "rsi": h.get("rsi"), "volume": h.get("volume"),
                     "tags": tags, "ecarter": sorted(BAD_TAGS & set(tags)), "titres": [it.get("title") for it in items[:3]]})
    d = {"date": today(), "equity_usd": equity, "limits": {k: cfg[k] for k in ("max_loss_per_trade_usd", "max_daily_loss_usd", "max_trades_per_day")},
         "scan": {k: scan.get(k) for k in ("universe", "scanned", "failed", "as_of", "source")}, "hits_total": len(hits), "candidats": rows,
         "sec": bool(os.environ.get("SEC_USER_AGENT"))}
    path = write("avant-ouverture", d)
    say("Scan : %s actions, %s retenues, %d setups (au %s)." % (d["scan"]["universe"], d["scan"]["scanned"], len(hits), d["scan"]["as_of"]))
    if not d["sec"]:
        say("Attention : SEC_USER_AGENT absent, pas de dépôts 8-K dans les news.")
    for r in rows:
        say("%2d. %-6s %-28s %8s  %s%s" % (r["rang"] + 1, r["symbol"], ",".join(r["setups"] or []), r["prix"], ",".join(r["tags"]) or "-",
                                          "  ÉCARTER (" + ",".join(r["ecarter"]) + ")" if r["ecarter"] else ""))
    say("Dossier complet : %s" % path, "→ Choisis jusqu'à %d actions à surveiller : python3 ops/pile.py surveiller SYM1,SYM2 --note \"…\"" % WATCH_MAX)
    return 0


def cmd_surveiller(a):
    syms = [x.strip().upper() for x in a.symboles.split(",") if x.strip()]
    if not 1 <= len(syms) <= WATCH_MAX:
        raise SkillError("entre 1 et %d symboles" % WATCH_MAX)
    dossier = json.load(open(os.path.join(TRADER, "dossier-avant-ouverture.json"), encoding="utf-8"))
    ranks = {r["symbol"]: r["rang"] for r in dossier["candidats"]}
    unknown = [s for s in syms if s not in ranks]
    if unknown:
        raise SkillError("pas dans le dossier du matin : " + ",".join(unknown))
    data = {"symbols": syms, "ranks": {s: ranks[s] for s in syms}, "scan_size": dossier["hits_total"]}
    api().post_journal({"pass": "avant-ouverture", "date": dossier["date"], "kind": "candidats", "title": "À surveiller : " + ", ".join(syms), "body": a.note, "data": data})
    say("Candidats enregistrés pour la cassure : " + ", ".join(syms))
    return 0


def _watch_list(p, date):
    j = p.journal(date)
    cands = [e for e in j.get("entries", []) if e["kind"] == "candidats"]
    if not cands:
        raise SkillError("aucun candidat du matin dans le journal : pas de trade aujourd'hui")
    return cands[-1]["data"]


def _chart(p, symbol):
    os.makedirs(os.path.join(TRADER, "data"), exist_ok=True)
    path = os.path.join(TRADER, "data", "%s-60d5m.json.gz" % symbol)
    try:
        save_chart(fetch_yahoo_chart(symbol), path)
        return path, "yahoo"
    except SkillError as e:
        save_chart(fetch_iex_chart(p, symbol), path)
        return path, "alpaca-iex (repli : %s)" % e


def _plan_candidates(p, s, cfg, equity, cash, symbols, ranks, scan_size, now):
    days = (p.crowd() or {}).get("days", [])
    pop = crowd_mod.popularity(days)
    results, fallbacks = [], []
    for sym in symbols:
        try:
            path, source = _chart(p, sym)
            if source != "yahoo":
                fallbacks.append(sym)
            c = candidate(WORK, sym, path, now, cfg, equity, cash, ranks.get(sym), scan_size, pop)
            c["source"] = source
        except SkillError as e:
            c = {"symbol": sym, "refus": str(e)}
        results.append(c)
    return results, pop, fallbacks


def _print_candidates(results):
    for c in results:
        cr = c.get("crowd") or {}
        tm = c.get("timemachine") or {}
        line = "%-6s foule %s" % (c["symbol"], cr.get("score", "-"))
        if tm:
            line += " · TM « %s » cible %.0f %% / stop %.0f %%, R après glissement %+.3f (historique %s)" % (
                tm["verdict"].split(":")[0], 100 * tm["target_first"], 100 * tm["stop_first"], tm["avg_r_after_costs"],
                "%+.3f sur %d" % (tm["history_avg_r_after_costs"], tm["history_trades"]) if tm.get("history_avg_r_after_costs") is not None else "-")
        say(line)
        if c.get("reel"):
            r = c["reel"]
            say("       ARMABLE : déclencheur %.2f, stop %.2f, objectif %.2f, %s actions (risque %.2f $), PASS %s" % (
                r["trigger"]["level"], r["stop"]["price"], r["target"]["price"], c["taille"]["qty"], c["taille"]["max_loss"], r["risk_pass"]))
        else:
            say("       non armable : %s" % c.get("refus", "?"))


def cmd_cassures(a):
    p = api()
    s = p.state()
    cfg, equity, cash = prepare(s)
    now = ny_now()
    if not (datetime.time(9, 45) <= now.time() <= datetime.time(15, 25)):
        raise SkillError("hors fenêtre : la fourchette d'ouverture se fixe à 9 h 45 New York")
    w = _watch_list(p, now.strftime("%Y-%m-%d"))
    armed = {pl["symbol"] for pl in (s.get("plans") or []) if pl["kind"] == "reel" and pl["status"] in ("arme", "declenche", "execute")}
    syms = [x for x in w["symbols"] if x not in armed]
    results, pop, fallbacks = _plan_candidates(p, s, cfg, equity, cash, syms, w["ranks"], w.get("scan_size", 0), now)
    scores = [c["crowd"]["score"] for c in results if c.get("crowd")]
    day_score = round(sum(scores) / len(scores), 2) if scores else None
    comps = {}
    for c in results:
        for k, v in (c.get("crowd") or {}).get("components", {}).items():
            if v is not None:
                comps.setdefault(k, []).append(v)
    comps = {k: round(sum(v) / len(v), 3) for k, v in comps.items()}
    if day_score is not None:
        p.post_crowd(now.strftime("%Y-%m-%d"), day_score, comps)
    if fallbacks:
        p.post_alert("warn", "yahoo_repli", "Yahoo indisponible pour %s : barres IEX du veilleur utilisées (volume IEX seulement)." % ",".join(fallbacks))
    d = {"date": now.strftime("%Y-%m-%d"), "now": now.isoformat(), "pass": a.passe, "equity_usd": equity, "cash_usd": cash,
         "limits": {"max_loss_trade_usd": cfg["max_loss_per_trade_usd"], "max_daily_loss_usd": cfg["max_daily_loss_usd"], "max_trades": cfg["max_trades_per_day"]},
         "crowd": {"score": day_score, "components": comps, "popularite": pop}, "candidats": results, "deja_armes": sorted(armed)}
    path = write("cassures", d)
    say("Indice de foule du jour : %s (estimation)." % day_score)
    _print_candidates(results)
    say("Dossier complet : %s" % path,
        "→ Arme au plus %d trades, seulement parmi les ARMABLE : python3 ops/pile.py armer SYM=\"pourquoi en 3 lignes max\" … (ou aucun)" % cfg["max_trades_per_day"])
    return 0


def cmd_armer(a):
    d = json.load(open(os.path.join(TRADER, "dossier-cassures.json"), encoding="utf-8"))
    by = {c["symbol"]: c for c in d["candidats"]}
    plans, chosen = [], []
    for item in a.choix:
        if "=" not in item:
            raise SkillError("format attendu : SYM=\"pourquoi\"")
        sym, why = item.split("=", 1)
        sym = sym.strip().upper()
        c = by.get(sym)
        if not c or not c.get("reel"):
            raise SkillError("%s n'est pas armable : %s" % (sym, (c or {}).get("refus", "absent du dossier")))
        if not why.strip() or len(why) > 400:
            raise SkillError("le pourquoi de %s doit faire 1 à 400 caractères" % sym)
        r = dict(c["reel"])
        r["why"] = why.strip()
        plans.append(r)
        chosen.append(sym)
    # The ghost trades every candidate the raw skill would, chosen or not.
    plans += [c["fantome"] for c in d["candidats"] if c.get("fantome")]
    body = {"pass": d["pass"], "date": d["date"], "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "equity_usd": d["equity_usd"], "limits": d["limits"], "plans": plans}
    if d["crowd"]["score"] is not None:
        body["crowd"] = {"score": d["crowd"]["score"], "components": d["crowd"]["components"]}
    res = api().post_plans(body)
    write("armer", {"body": body, "result": res})
    say("Armés : %s" % (", ".join(res.get("accepted", [])) or "aucun"))
    for r in res.get("rejected", []):
        say("Refusé par le veilleur : %s — %s" % (r["id"], r["reason"]))
    if not chosen:
        say("Aucun trade réel armé aujourd'hui : c'est un résultat normal.")
    return 0 if not res.get("rejected") else 2


def cmd_mi_seance(a):
    p = api()
    s = p.state()
    cfg, equity, cash = prepare(s)
    now = ny_now()
    armed = [pl for pl in (s.get("plans") or []) if pl["kind"] == "reel" and pl["status"] == "arme"]
    syms = [pl["symbol"] for pl in armed]
    news = {}
    if syms:
        code, nj, err = run("news", news_args(syms, 4, bool(os.environ.get("SEC_USER_AGENT"))), WORK, timeout=600, ok_codes=(0, 1))
        for it in (nj or {}).get("items", []):
            news.setdefault(it.get("ticker"), []).append(it)
    d = {"date": now.strftime("%Y-%m-%d"), "armes": armed, "news": news}
    say("Plans réels armés : %s" % (", ".join(syms) or "aucun"))
    for sym in syms:
        items = news.get(sym, [])
        flags = sorted(BAD_TAGS & tags_of(items))
        say("  %s : %d nouvelle(s)%s" % (sym, len(items), " — À DÉSARMER ? (" + ",".join(flags) + ")" if flags else ""))
        for it in items[:3]:
            say("     · %s" % it["title"])
    if a.nouveaux and now.time() <= datetime.time(15, 0):
        try:
            w = _watch_list(p, d["date"])
            rest = [x for x in w["symbols"] if x not in syms]
            results, _, _ = _plan_candidates(p, s, cfg, equity, cash, rest, w["ranks"], w.get("scan_size", 0), now)
            d["candidats"] = results
            say("Candidats du matin pas encore partis :")
            _print_candidates(results)
            write("cassures", {"date": d["date"], "now": now.isoformat(), "pass": "mi-seance", "equity_usd": equity, "cash_usd": cash,
                               "limits": {"max_loss_trade_usd": cfg["max_loss_per_trade_usd"], "max_daily_loss_usd": cfg["max_daily_loss_usd"], "max_trades": cfg["max_trades_per_day"]},
                               "crowd": {"score": None, "components": {}}, "candidats": results, "deja_armes": syms})
        except SkillError as e:
            say("Pas de nouveaux setups : %s" % e)
    write("mi-seance", d)
    say("→ Désarmer : python3 ops/pile.py desarmer SYM --raison \"…\" · Armer un nouveau : python3 ops/pile.py armer SYM=\"…\"")
    return 0


def cmd_desarmer(a):
    p = api()
    s = p.state()
    sym = a.symbole.upper()
    ids = [pl["id"] for pl in (s.get("plans") or []) if pl["symbol"] == sym and pl["kind"] == "reel" and pl["status"] == "arme"]
    if not ids:
        raise SkillError("aucun plan armé pour %s" % sym)
    m = s.get("money") or {}
    lim = s.get("limits") or {}
    body = {"pass": "mi-seance", "date": today(), "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "equity_usd": m.get("usd") or 1, "limits": {"max_loss_trade_usd": lim.get("max_loss_trade_usd") or 0.01, "max_daily_loss_usd": lim.get("max_daily_loss_usd") or 0.01, "max_trades": 3},
            "plans": [], "disarm": ids}
    res = p.post_plans(body)
    p.post_journal({"pass": "mi-seance", "date": today(), "kind": "note", "title": "Désarmé : " + sym, "body": a.raison})
    say("Désarmé : %s" % (", ".join(res.get("disarmed", [])) or "rien"))
    return 0


def cmd_bilan(a):
    p = api()
    s = p.state()
    date = today()
    series = p._call("GET", "/api/series?range=1j")
    pts = [x for x in series.get("points", []) if x.get("toi") is not None]
    first, last = (pts[0], pts[-1]) if pts else (None, None)
    plans = p.plans(date).get("plans", [])
    j = p.journal(date).get("entries", [])
    def ends(key):
        vals = [x[key] for x in series.get("points", []) if x.get(key) is not None]
        return {"debut": vals[0] if vals else None, "fin": vals[-1] if vals else None}

    d = {
        "date": date,
        "toi": ends("toi"),
        "sp": ends("sp"),
        "fantome": ends("fantome"),
        "argent": s.get("money"),
        "plans": plans,
        "journal": [{"pass": e["pass"], "kind": e["kind"], "title": e.get("title"), "body": e["body"]} for e in j],
        "trades": [],  # trades arrive with milestone 5
    }
    write("bilan", d)
    def line(name, e):
        if e["debut"] is None:
            return "%s : pas encore de données" % name
        return "%s : %.2f € → %.2f € (%+.2f €)" % (name, e["debut"], e["fin"], e["fin"] - e["debut"])

    if first:
        say(" · ".join(line(n, d[k]) for n, k in (("Toi", "toi"), ("S&P", "sp"), ("Fantôme", "fantome"))))
    m = s.get("money") or {}
    say("Depuis le départ : %.2f € (%+.2f € face aux 50 €)." % (m.get("eur", 0), m.get("delta_eur", 0)))
    say("Plans du jour : %s" % (", ".join("%s %s (%s)" % (x["kind"], x["symbol"], x["status"]) for x in plans) or "aucun"))
    say("→ Écris le bilan : python3 ops/pile.py ecrire-bilan --titre \"…\" --texte \"…\"")
    return 0


def cmd_ecrire_bilan(a):
    d = json.load(open(os.path.join(TRADER, "dossier-bilan.json"), encoding="utf-8"))
    data = {k: d[k] for k in ("toi", "sp", "fantome")}
    api().post_journal({"pass": "bilan", "date": d["date"], "kind": "bilan", "title": a.titre, "body": a.texte, "data": data})
    say("Bilan enregistré.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pile.py", description="Commandes des passages de Pile.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    passes = ["avant-ouverture", "cassures", "mi-seance", "bilan"]
    p = sub.add_parser("etat")
    p.add_argument("--passe", default="", choices=[""] + passes)
    p = sub.add_parser("debut")
    p.add_argument("passe", choices=passes)
    p = sub.add_parser("fin")
    p.add_argument("passe", choices=passes)
    p.add_argument("--saute", metavar="RAISON")
    p = sub.add_parser("erreur")
    p.add_argument("passe", choices=passes)
    p.add_argument("texte")
    sub.add_parser("avant-ouverture")
    p = sub.add_parser("surveiller")
    p.add_argument("symboles")
    p.add_argument("--note", required=True)
    p = sub.add_parser("cassures")
    p.set_defaults(passe="cassures")
    p = sub.add_parser("armer")
    p.add_argument("choix", nargs="*", help='SYM="pourquoi"')
    p = sub.add_parser("mi-seance")
    p.add_argument("--nouveaux", action="store_true", help="refaire les plans des candidats pas encore partis")
    p = sub.add_parser("desarmer")
    p.add_argument("symbole")
    p.add_argument("--raison", required=True)
    sub.add_parser("bilan")
    p = sub.add_parser("ecrire-bilan")
    p.add_argument("--titre", required=True)
    p.add_argument("--texte", required=True)
    a = ap.parse_args(argv)
    fn = globals()["cmd_" + a.cmd.replace("-", "_")]
    try:
        return fn(a)
    except (SkillError, ApiError) as e:
        say("ERREUR : %s" % e, "→ Signale-la : python3 ops/pile.py erreur <passage> \"%s\" puis arrête le passage." % str(e)[:200])
        return 2


if __name__ == "__main__":
    sys.exit(main())
