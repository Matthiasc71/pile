"""Crowd index (brief 5.5): an estimate, 0 to 5, of how many people trade
the same signal with the same skill and settings. Nobody can count them;
each component is a proxy between 0 and 1, weighted in ops/foule.json."""

import json
import math
import os
import statistics

FOULE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "foule.json")


def load_config(path=FOULE):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def popularity(days):
    """Stars and forks of the skill, and their 7-day growth.

    days: [{date, stars, forks}], newest first (from GET /api/crowd)."""
    rows = [d for d in days if d.get("stars") or d.get("forks")]
    if not rows:
        return None
    now = rows[0]
    reach = now["stars"] + 2 * now["forks"]
    size = min(1.0, math.log10(1 + reach) / 4.0)  # 10 000 ≈ 1
    growth = 0.0
    old = next((d for d in rows if d["date"] <= _minus_days(now["date"], 7)), None)
    if old:
        base = old["stars"] + 2 * old["forks"]
        growth = min(1.0, max(0.0, (reach - base) / max(base, 1) / 0.10))  # +10 % a week ≈ 1
    return round(0.7 * size + 0.3 * growth, 3)


def _minus_days(date, n):
    import datetime

    d = datetime.date.fromisoformat(date) - datetime.timedelta(days=n)
    return d.isoformat()


def evident(rank, total):
    """Rank in the default scan: what everyone sees first. Top 3 = 1, fades to 0 at 30."""
    if rank is None or total <= 0:
        return 0.0
    if rank < 3:
        return 1.0
    return round(max(0.0, 1.0 - (rank - 3) / 27.0), 3)


def volume(or_volume, past_or_volumes):
    """Opening-range volume today against the median of the last sessions at the same time."""
    past = [v for v in past_or_volumes if v and v > 0]
    if not or_volume or len(past) < 5:
        return 0.5
    ratio = or_volume / statistics.median(past)
    return round(min(1.0, max(0.0, (ratio - 1.0) / 2.0)), 3)  # 1× = 0, 3× = 1


def levels(stop, target):
    """Canonical levels: the range midpoint is always obvious; round numbers add to it."""
    from .rules import is_round

    score = 0.6
    if is_round(stop):
        score += 0.2
    if is_round(target):
        score += 0.2
    return round(min(1.0, score), 3)


def score(components, cfg, ghost_trades=0):
    """5 × weighted mean. "mesure" only weighs in once the ghost has traded."""
    w = dict(cfg["weights"])
    w["mesure"] = w.get("mesure", 0) * min(1.0, ghost_trades / 20.0)
    num = den = 0.0
    for k, weight in w.items():
        v = components.get(k)
        if v is None or weight <= 0:
            continue
        num += weight * v
        den += weight
    return round(5.0 * num / den, 2) if den else 0.0
