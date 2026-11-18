"""One candidate, from its chart to the two plans the watcher stores.

- fantome: the skill used raw, like everyone (entry on the canonical bar
  close above the range high, stop at the range midpoint, target 2R, no
  strict filter, no crowd adaptation).
- reel: the same setup adapted to the crowd (brief 5.5) and armed only if the
  strict Time Machine filter holds (brief 5.4) and trader-risk says PASS.
Every price comes from the skill's tools (entry, exit, timemachine, risk).
"""

import datetime
import json
import os

from . import crowd as crowd_mod
from . import rules
from .skill import SkillError, bars_of, load_chart, opening_volumes, run

SETUP = "orb15"


def entry_time_label(now):
    """Close time of the last complete 5-minute bar, as the Time Machine wants it ("9:45 AM")."""
    open_ = now.replace(hour=9, minute=30, second=0, microsecond=0)
    k = max(3, int((now - open_).total_seconds() // 300))
    close = open_ + datetime.timedelta(minutes=5 * k)
    h = close.hour % 12 or 12
    return "%d:%02d %s" % (h, close.minute, "AM" if close.hour < 12 else "PM")


def plan_body(kind, symbol, date, orr, atr5, level, buffer_atr, delay, stop, stop_rule, target, target_r, avoid_round, size, tm, risk_pass, crowd_score, adaptations, why):
    pid = "%s-%s-orb%s" % (date, symbol, "-fantome" if kind == "fantome" else "")
    return {
        "id": pid,
        "kind": kind,
        "symbol": symbol,
        "setup": SETUP,
        "or": {"high": orr["high"], "low": orr["low"], "mid": round((orr["high"] + orr["low"]) / 2, 4)},
        "atr_5m": round(atr5, 4),
        "trigger": {"type": "close_above", "bar": "5m", "level": level, "buffer_atr": buffer_atr, "delay_s": list(delay)},
        "stop": {"rule": stop_rule, "price": stop},
        "target": {"r": target_r, "price": target, "avoid_round": avoid_round},
        "size": {"risk_usd": size["risk_usd"], "max_notional_usd": size["max_notional_usd"], "whole_shares": size.get("whole", False)},
        "window": ["09:45", "15:30"],
        "flat_by": "15:55",
        "timemachine": tm,
        "risk_pass": risk_pass,
        "crowd_score": crowd_score,
        "adaptations": adaptations,
        "why": why,
    }


def exit_plan(workdir, symbol, date, entry, orr, now_s, stop_arg, target_arg, write=None):
    args = ["plan", "--symbol", symbol, "--entry", "%.2f" % entry, "--or-high", str(orr["high"]), "--or-low", str(orr["low"]),
            "--setup", "orb", "--date", date, "--time", "9:50 AM", "--interval", "5m", "--stop", stop_arg, "--target", target_arg,
            "--now", now_s, "--json"]
    if write:
        args += ["--write", write]
    code, out, err = run("exit", args, workdir, ok_codes=(0, 1, 2))
    if code != 0 or not out or out.get("stop") is None:
        raise SkillError("trader-exit refuse : " + ((out or {}).get("error") or err or "plan impossible"))
    return out


def time_machine(workdir, symbol, date, entry, stop, target, now, now_s, chart_path):
    args = ["run", "--symbol", symbol, "--date", date, "--entry", "%.2f" % entry, "--stop", "%.2f" % stop, "--target", "%.2f" % target,
            "--entry-time", entry_time_label(now), "--stop-rule", "or_mid", "--seed", "19", "--replays", "10000",
            "--offline", chart_path, "--now", now_s, "--until", "15:55", "--json"]
    code, out, err = run("timemachine", args, workdir, timeout=600)
    if code != 0 or not out:
        raise SkillError("Time Machine : " + err)
    return out


def risk_check(workdir, symbol, qty, whole, entry, stop, target, cfg, now_s, date, last_price):
    """Write the order in trader-budget's format and let trader-risk judge it."""
    tdir = os.path.join(workdir, "trader")
    os.makedirs(tdir, exist_ok=True)
    order = {
        "symbol": symbol,
        "side": "buy",
        "qty": ("%d" % qty) if whole else ("%.4f" % qty).rstrip("0").rstrip("."),
        "type": "market",
        "time_in_force": "day",
        "why": "Pile : cassure d'ouverture sur %s" % symbol,
        "plan": {"entry": entry, "stop": stop, "target": target, "risk_per_share": round(entry - stop, 2),
                 "max_loss": round(qty * (entry - stop), 2), "setup": "orb", "entry_time": "9:50 AM", "flat_by": cfg["flat_by"]},
    }
    if whole:
        order.update({"order_class": "bracket", "take_profit_limit_price": "%.2f" % target, "stop_loss_stop_price": "%.2f" % stop})
    with open(os.path.join(tdir, "orders.json"), "w", encoding="utf-8") as fh:
        json.dump({"created_by": "pile-ops", "status": "proposed", "paper": True, "orders": [order]}, fh, indent=1)
    with open(os.path.join(tdir, "prices.json"), "w", encoding="utf-8") as fh:
        json.dump({symbol: last_price}, fh)
    code, out, err = run("risk", ["--now", now_s, "--today", date, "--no-write", "--json"], workdir, ok_codes=(0, 1, 2))
    if not out:
        raise SkillError("trader-risk : " + err)
    res = (out.get("orders") or out.get("results") or [{}])[0]
    return res, order


def candidate(workdir, symbol, chart_path, now, cfg, equity_usd, cash_usd, rank, scan_size, popularity, ghost_trades=0, slip_pct=None, foule=None):
    """Everything about one candidate. Never raises for a refusal: it says why."""
    foule = foule or crowd_mod.load_config()
    date = now.strftime("%Y-%m-%d")
    now_s = now.strftime("%Y-%m-%d %H:%M")
    slip = rules.slippage_pct(slip_pct)
    out = {"symbol": symbol, "rank": rank, "date": date, "now": now_s, "slippage_pct": slip}

    code, entry, err = run("entry", ["check", symbol, "--setup", "orb", "--or-minutes", "15", "--offline", chart_path, "--now", now_s, "--json"], workdir, ok_codes=(0, 1, 2))
    if not entry:
        out["refus"] = "trader-entry : " + err
        return out
    out["entry_status"] = entry.get("status")
    orr = entry.get("opening_range") or {}
    if not orr.get("complete"):
        out["refus"] = "fourchette d'ouverture incomplète"
        return out
    if entry.get("status") != "waiting":
        out["refus"] = "déjà %s : %s" % (entry.get("status"), entry.get("reason", ""))
        return out
    out["or"] = {"high": orr["high"], "low": orr["low"]}
    last = (entry.get("last") or {}).get("close") or orr["high"]
    out["last"] = last

    chart = load_chart(chart_path)
    bars = [b for b in bars_of(chart) if b["t"] <= now]
    atr5 = rules.atr([{"h": b["h"], "l": b["l"], "c": b["c"]} for b in bars[-15:]])
    out["atr_5m"] = round(atr5, 4)
    today_vol, past_vol = opening_volumes(bars, now.date())

    # --- the ghost: raw skill settings ---
    level = orr["high"]
    canon = exit_plan(workdir, symbol, date, level, orr, now_s, "or-mid", "2R")
    comp = {
        "popularite": popularity,
        "evident": crowd_mod.evident(rank, scan_size),
        "volume": crowd_mod.volume(today_vol, past_vol),
        "niveaux": crowd_mod.levels(canon["stop"], canon["target"]),
        "mesure": None,
    }
    score = crowd_mod.score(comp, foule, ghost_trades)
    out["crowd"] = {"components": comp, "score": score}
    risk_usd = cfg["max_loss_per_trade_usd"]
    cash_avail = max(0.0, cash_usd - equity_usd * cfg["cash_buffer_pct"] / 100.0)
    try:
        g_size = rules.size(level, canon["stop"], risk_usd, cfg["max_order_usd"], cash_avail)
        g_size.update(risk_usd=risk_usd, max_notional_usd=cfg["max_order_usd"])
        out["fantome"] = plan_body("fantome", symbol, date, orr, atr5, level, 0, (0, 0), canon["stop"], "or-mid", canon["target"], 2.0, False, g_size,
                                   None, None, score, [], "Réglages bruts du skill : cassure de la fourchette 9 h 30 – 9 h 45, stop au milieu, objectif 2R.")
    except ValueError as e:
        out["fantome_refus"] = str(e)

    # --- the real plan: adapted to the crowd ---
    a = foule["adaptations"]
    strong = score >= foule["seuils"]["foule_forte"]
    very = score >= foule["seuils"]["foule_tres_forte"]
    adaptations = []
    if very and rank is not None and rank < a["eviter_premiers_du_scan"]:
        out["refus"] = "foule très forte (%.1f) et %s est parmi les %d premiers du scan" % (score, symbol, a["eviter_premiers_du_scan"])
        return out
    if strong:
        buffer_atr = a["tampon_atr"]
        delay = tuple(a["delai_s"])
        r_level = rules.round_cents(level + buffer_atr * atr5 + 0.004)
        r_stop = rules.off_round_down((orr["high"] + orr["low"]) / 2 - a["stop_ecart_atr"] * atr5)
        r_target = rules.before_round(r_level + 2 * (r_level - r_stop), r_level)
        adaptations += ["entrée décalée de %d à %d s, au-dessus du haut + %.1f ATR" % (delay[0], delay[1], buffer_atr),
                        "stop au milieu − %.2f ATR, hors chiffre rond" % a["stop_ecart_atr"], "objectif juste avant un chiffre rond"]
        stop_arg, target_arg, stop_rule = "price:%.2f" % r_stop, "price:%.2f" % r_target, "or-mid-%.2fatr" % a["stop_ecart_atr"]
    else:
        buffer_atr, delay, r_level = 0.0, (0, 0), level
        stop_arg, target_arg, stop_rule = "or-mid", "2R", "or-mid"
    if very:
        risk_usd = rules.floor_cents(risk_usd * a["taille_tres_forte"])
        adaptations.append("taille × %.1f (foule très forte)" % a["taille_tres_forte"])
    try:
        rp = exit_plan(workdir, symbol, date, r_level, orr, now_s, stop_arg, target_arg)
    except SkillError as e:
        out["refus"] = str(e)
        return out
    r_stop, r_target = rp["stop"], rp["target"]
    target_r = round((r_target - r_level) / (r_level - r_stop), 2)

    tm = time_machine(workdir, symbol, date, r_level, r_stop, r_target, now, now_s, chart_path)
    after = rules.tm_after_costs(tm, slip)
    passed, reasons = rules.strict_filter(tm, after)
    mc = tm["mc"]
    tm_summary = {
        "verdict": tm["verdict"], "seed": mc["seed"], "replays": mc["replays"],
        "target_first": mc["p_target"], "stop_first": mc["p_stop"], "neither": mc["p_neither"],
        "avg_r": after["avg_r"], "avg_r_after_costs": after["avg_r_after_costs"],
        "history_trades": after["history_trades"], "history_avg_r": after["history_avg_r"],
        "history_avg_r_after_costs": after["history_avg_r_after_costs"], "slippage_pct": slip,
    }
    out["timemachine"] = tm_summary
    out["filtre_strict"] = {"ok": passed, "raisons": reasons}
    if not passed:
        out["refus"] = "filtre Time Machine strict : " + " ; ".join(reasons)
        return out

    try:
        sz = rules.size(r_level, r_stop, risk_usd, cfg["max_order_usd"], cash_avail)
    except ValueError as e:
        out["refus"] = "taille : %s" % e
        return out
    sz.update(risk_usd=risk_usd, max_notional_usd=cfg["max_order_usd"])
    verdict, order = risk_check(workdir, symbol, sz["qty"], sz["whole"], r_level, r_stop, r_target, cfg, now_s, date, last)
    out["taille"] = sz
    out["risk"] = {"verdict": verdict.get("verdict"), "reasons": verdict.get("reasons") or verdict.get("blocks") or [], "fingerprint": verdict.get("fingerprint")}
    if verdict.get("verdict") != "PASS":
        out["refus"] = "trader-risk BLOCK : " + "; ".join(out["risk"]["reasons"]) if out["risk"]["reasons"] else "trader-risk : pas de PASS"
        return out
    out["reel"] = plan_body("reel", symbol, date, orr, atr5, r_level, buffer_atr, delay, r_stop, stop_rule, r_target, target_r, strong,
                            sz, tm_summary, verdict["fingerprint"], score, adaptations, "")
    return out
