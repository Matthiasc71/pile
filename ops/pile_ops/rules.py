"""Pure rules (tested): limits scaled to the account, ATR, slippage in R,
the strict Time Machine filter, round numbers, fractional sizing."""

import math

# Brief 5.3: the skill's recommended proportions (5,000 $ example), scaled.
LOSS_PER_TRADE_PCT = 1.0
LOSS_PER_DAY_PCT = 3.0
MAX_TRADES = 3
MAX_POSITION_PCT = 75.0
CASH_BUFFER_PCT = 10.0
MIN_ORDER_USD = 1.0

# Brief 6.4: slippage per side, floor 0.05 %.
SLIPPAGE_FLOOR_PCT = 0.05

STRICT_VERDICTS = ("Leans toward the target", "Strongly toward the target")


def floor_cents(x):
    return math.floor(x * 100 + 1e-9) / 100.0


def round_cents(x):
    return math.floor(x * 100 + 0.5 + 1e-9) / 100.0


def skill_config(equity_usd, sec_user_agent=""):
    """trader/config.json for this account: the example's rules at the same proportions."""
    e = float(equity_usd)
    return {
        "budget": round_cents(e),
        "cash_buffer_pct": CASH_BUFFER_PCT,
        "max_position_pct": MAX_POSITION_PCT,
        "max_order_usd": floor_cents(e * MAX_POSITION_PCT / 100),
        "min_order_usd": MIN_ORDER_USD,
        "max_loss_per_trade_usd": floor_cents(e * LOSS_PER_TRADE_PCT / 100),
        "max_daily_loss_usd": floor_cents(e * LOSS_PER_DAY_PCT / 100),
        "max_trades_per_day": MAX_TRADES,
        "max_orders_per_day": 10,
        "min_reward_risk": 1.0,
        "require_stop": True,
        "no_entries_before": "09:45",
        "no_entries_after": "15:30",
        "flat_by": "15:55",
        "fractional": True,
        "broker": "alpaca",
        "paper": True,
        "blocked": [],
        "allow_options": False,
        "allow_margin": False,
        "allow_short": False,
        "pdt_guard": False,
        "sec_user_agent": sec_user_agent,
    }


def atr(bars, n=14):
    """Average true range of the last n bars (bars: dicts with h, l, c, oldest first)."""
    if len(bars) < 2:
        return 0.0
    trs = []
    for prev, b in zip(bars[:-1], bars[1:]):
        trs.append(max(b["h"] - b["l"], abs(b["h"] - prev["c"]), abs(b["l"] - prev["c"])))
    last = trs[-n:]
    return sum(last) / len(last)


def slippage_pct(observed_pct=None):
    """Per-side cost: the mean observed slippage, never under the floor."""
    if observed_pct is None:
        return SLIPPAGE_FLOOR_PCT
    return max(SLIPPAGE_FLOOR_PCT, float(observed_pct))


def cost_in_r(entry, stop, slip_pct):
    """Round-trip slippage (both sides) expressed in R for one trade."""
    risk = entry - stop
    if risk <= 0:
        raise ValueError("stop must be under the entry")
    return 2 * entry * slip_pct / 100.0 / risk


def tm_after_costs(tm, slip_pct):
    """Average R after slippage, on the replays and on the real history.

    tm is the JSON printed by `timemachine.py run --json`."""
    plan = tm["plan"]
    mc_cost = cost_in_r(plan["entry"], plan["stop"], slip_pct)
    hist = tm.get("history") or {}
    trades = [t for t in hist.get("trades", []) if t.get("entry") and t.get("stop") and t["entry"] > t["stop"]]
    if trades:
        hist_after = sum(t["R"] - cost_in_r(t["entry"], t["stop"], slip_pct) for t in trades) / len(trades)
    else:
        hist_after = None
    return {
        "avg_r": tm["mc"]["avg_R"],
        "avg_r_after_costs": round(tm["mc"]["avg_R"] - mc_cost, 4),
        "history_trades": len(trades),
        "history_avg_r": hist.get("avg_R"),
        "history_avg_r_after_costs": None if hist_after is None else round(hist_after, 4),
    }


def strict_filter(tm, after):
    """Brief 5.4: the three conditions. Returns (passed, reasons)."""
    reasons = []
    verdict = tm.get("verdict") or ""
    if not verdict.startswith(STRICT_VERDICTS):
        reasons.append("verdict « %s »" % verdict.split(":")[0])
    if not (after["avg_r_after_costs"] > 0):
        reasons.append("R moyen après glissement %+.3f sur les rejeux" % after["avg_r_after_costs"])
    h = after["history_avg_r_after_costs"]
    if h is None:
        reasons.append("aucun déclenchement dans l'historique")
    elif not (h > 0):
        reasons.append("R moyen après glissement %+.3f sur l'historique (%d trades)" % (h, after["history_trades"]))
    if tm.get("mc", {}).get("seed") != 19:
        reasons.append("graine différente de 19")
    return (not reasons, reasons)


def is_round(price):
    """On a whole or half dollar: where the crowd puts its orders."""
    cents = int(round(price * 100)) % 100
    return cents in (0, 50)


def off_round_down(price):
    """A stop just under, never on, a round number."""
    p = floor_cents(price)
    if is_round(p):
        p = round_cents(p - 0.03)
    return p


def before_round(target, entry):
    """A target just before the next round number above, if it lies between entry and target."""
    t = floor_cents(target)
    half = math.floor(t * 2) / 2.0
    if is_round(t):
        t = round_cents(t - 0.02)
    elif half > entry and t - half < 0.10:
        t = round_cents(half - 0.02)
    return t


def size(entry, stop, risk_usd, max_notional_usd, cash_usd):
    """Shares for this risk: whole shares when at least one fits, else a fraction (4 decimals).

    Returns dict(qty, whole, notional, max_loss) or raises ValueError with the reason."""
    rps = entry - stop
    if rps <= 0:
        raise ValueError("stop au-dessus de l'entrée")
    cap_usd = min(max_notional_usd, cash_usd)
    by_risk = risk_usd / rps
    by_cash = cap_usd / entry
    whole = math.floor(min(by_risk, by_cash) + 1e-9)
    if whole >= 1:
        qty = float(whole)
        is_whole = True
    else:
        qty = math.floor(min(by_risk, by_cash) * 10000) / 10000.0
        is_whole = False
    notional = qty * entry
    if notional < MIN_ORDER_USD:
        raise ValueError("ordre de %.2f $ sous le minimum de %.0f $" % (notional, MIN_ORDER_USD))
    return {"qty": qty, "whole": is_whole, "notional": round(notional, 2), "max_loss": round(qty * rps, 2)}
