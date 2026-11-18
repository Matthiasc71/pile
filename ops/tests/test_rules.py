import pytest

from pile_ops import rules


def test_config_keeps_the_skill_proportions():
    c = rules.skill_config(55.0)
    assert c["max_loss_per_trade_usd"] == 0.55  # 1 %
    assert c["max_daily_loss_usd"] == 1.65  # 3 %
    assert c["max_trades_per_day"] == 3
    assert c["max_order_usd"] == 41.25  # 75 %
    assert c["cash_buffer_pct"] == 10
    assert c["paper"] is True and c["fractional"] is True
    assert c["allow_margin"] is False and c["allow_short"] is False and c["allow_options"] is False
    assert c["no_entries_before"] == "09:45" and c["no_entries_after"] == "15:30" and c["flat_by"] == "15:55"


def test_slippage_floor_and_cost_in_r():
    assert rules.slippage_pct() == 0.05
    assert rules.slippage_pct(0.01) == 0.05
    assert rules.slippage_pct(0.12) == 0.12
    # entry 100, stop 99: 2 × 100 × 0.05 % = 0.10 $ = 0.1 R
    assert rules.cost_in_r(100, 99, 0.05) == pytest.approx(0.1)
    with pytest.raises(ValueError):
        rules.cost_in_r(100, 101, 0.05)


def tm(verdict="Leans toward the target: …", avg_r=0.2, seed=19, trades=None):
    return {"verdict": verdict, "mc": {"avg_R": avg_r, "seed": seed}, "plan": {"entry": 100.0, "stop": 99.0},
            "history": {"avg_R": 0.1, "trades": trades if trades is not None else [{"entry": 50.0, "stop": 49.5, "R": 0.5}, {"entry": 50.0, "stop": 49.5, "R": -0.2}]}}


def test_strict_filter_accepts_only_a_clear_edge_after_costs():
    t = tm()
    after = rules.tm_after_costs(t, 0.05)
    assert after["avg_r_after_costs"] == pytest.approx(0.1)  # 0.2 − 0.1
    assert after["history_avg_r_after_costs"] == pytest.approx(0.15 - 0.1)  # mean(0.5, −0.2) − 0.1
    assert rules.strict_filter(t, after) == (True, [])


@pytest.mark.parametrize("t, why", [
    (tm(verdict="Close to a coin flip: …"), "verdict"),
    (tm(verdict="Leans toward the stop: …"), "verdict"),
    (tm(avg_r=0.05), "rejeux"),
    (tm(trades=[{"entry": 50.0, "stop": 49.5, "R": 0.1}]), "historique"),
    (tm(trades=[]), "aucun déclenchement"),
    (tm(seed=7), "graine"),
])
def test_strict_filter_refusals(t, why):
    ok, reasons = rules.strict_filter(t, rules.tm_after_costs(t, 0.05))
    assert not ok
    assert any(why in r for r in reasons)


def test_round_numbers():
    assert rules.is_round(160.0) and rules.is_round(160.5) and not rules.is_round(160.49)
    assert rules.off_round_down(160.0) == 159.97
    assert rules.off_round_down(160.004) == 159.97
    assert rules.off_round_down(160.13) == 160.13
    assert rules.before_round(162.04, 160.0) == 161.98  # just before 162.00
    assert rules.before_round(162.5, 160.0) == 162.48
    assert rules.before_round(162.3, 160.0) == 162.3


def test_size_fraction_when_no_whole_share_fits():
    s = rules.size(362.19, 356.33, 0.55, 41.25, 49.5)
    assert not s["whole"]
    assert s["qty"] == 0.0938
    assert s["max_loss"] <= 0.55


def test_size_whole_shares_when_one_fits():
    s = rules.size(20.0, 19.8, 0.55, 41.25, 49.5)
    assert s["whole"] and s["qty"] == 2.0  # 2 × 0.20 = 0.40 $ ≤ 0.55 $, 40 $ ≤ 41.25 $


def test_size_is_capped_by_position_and_cash():
    s = rules.size(10.0, 9.99, 0.55, 41.25, 30.0)
    assert s["qty"] == 3.0  # cash 30 $ / 10 $
    with pytest.raises(ValueError):
        rules.size(500.0, 499.0, 0.55, 41.25, 0.4)


def test_atr():
    bars = [{"h": 10, "l": 9, "c": 9.5}, {"h": 10.2, "l": 9.4, "c": 10}, {"h": 11, "l": 10, "c": 10.5}]
    assert rules.atr(bars) == pytest.approx((0.8 + 1.0) / 2)
