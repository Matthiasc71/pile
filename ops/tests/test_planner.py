"""The whole cassures chain on the skill's real data: TSLA, 19 Oct 2026, 9:47 New York."""
import datetime
import json
import os
import shutil

import pytest

from conftest import FIX
from pile_ops import crowd, planner, rules
from pile_ops.skill import NY, bars_of, chart_from_iex, load_chart, opening_volumes, run, save_chart

CHART = os.path.join(FIX, "trader-timemachine", "TSLA-60d5m.json.gz")
NOW = datetime.datetime(2026, 10, 19, 9, 47, tzinfo=NY)


@pytest.fixture
def work(tmp_path):
    (tmp_path / "trader").mkdir()
    return str(tmp_path)


def test_entry_time_label():
    assert planner.entry_time_label(NOW) == "9:45 AM"
    assert planner.entry_time_label(datetime.datetime(2026, 10, 19, 12, 1, tzinfo=NY)) == "12:00 PM"
    assert planner.entry_time_label(datetime.datetime(2026, 10, 19, 13, 7, tzinfo=NY)) == "1:05 PM"


def test_tsla_candidate(work):
    cfg = rules.skill_config(55.0)
    c = planner.candidate(work, "TSLA", CHART, NOW, cfg, 55.0, 55.0, rank=5, scan_size=200, popularity=0.6)
    assert c["entry_status"] == "waiting"
    assert c["or"] == {"high": 362.18, "low": 354.47}
    # The ghost: the raw skill, exactly as trader-exit sets it.
    g = c["fantome"]
    assert g["id"] == "2026-10-19-TSLA-orb-fantome" and g["kind"] == "fantome"
    assert g["trigger"]["level"] == 362.18 and g["stop"]["price"] == 358.32 and g["timemachine"] is None
    assert g["size"]["risk_usd"] == 0.55
    # The crowd estimate and the strict Time Machine verdict are reported either way.
    assert 0 <= c["crowd"]["score"] <= 5
    tm = c["timemachine"]
    assert tm["seed"] == 19 and tm["replays"] == 10000 and tm["slippage_pct"] == 0.05
    assert tm["avg_r_after_costs"] < tm["avg_r"]
    # That morning the skill itself said break-even, history negative: not armable.
    assert c["filtre_strict"]["ok"] is False
    assert "reel" not in c and c["refus"].startswith("filtre Time Machine strict")


def test_risk_check_passes_a_fraction(work):
    cfg = rules.skill_config(55.0)
    with open(os.path.join(work, "trader", "config.json"), "w") as fh:
        json.dump(cfg, fh)
    verdict, order = planner.risk_check(work, "TSLA", 0.0938, False, 362.19, 356.33, 373.91, cfg, "2026-10-19 09:47", "2026-10-19", 360.39)
    assert verdict["verdict"] == "PASS" and len(verdict["fingerprint"]) == 16
    assert order["qty"] == "0.0938" and "order_class" not in order
    # Over the max loss: trader-risk blocks it.
    verdict, _ = planner.risk_check(work, "TSLA", 0.5, False, 362.19, 356.33, 373.91, cfg, "2026-10-19 09:47", "2026-10-19", 360.39)
    assert verdict["verdict"] == "BLOCK"


def test_iex_fallback_chart_is_read_by_the_skill(work):
    yahoo = load_chart(CHART)
    bars = [{"t": b["t"].astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for b in bars_of(yahoo)]
    chart = chart_from_iex("TSLA", bars, previous_close=354.72)
    path = save_chart(chart, os.path.join(work, "trader", "TSLA-iex.json.gz"))
    code, out, err = run("entry", ["check", "TSLA", "--offline", path, "--now", "2026-10-19 09:47", "--json"], work, ok_codes=(0, 1, 2))
    assert out and out["opening_range"]["high"] == 362.18, err
    today, past = opening_volumes(bars_of(chart), NOW.date())
    assert today and len(past) == 20
