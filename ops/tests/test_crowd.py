from pile_ops import crowd


def test_popularity_grows_with_reach_and_weekly_growth():
    flat = [{"date": "2026-11-17", "stars": 400, "forks": 50}, {"date": "2026-11-10", "stars": 400, "forks": 50}]
    growing = [{"date": "2026-11-17", "stars": 480, "forks": 60}, {"date": "2026-11-10", "stars": 400, "forks": 50}]
    assert 0 < crowd.popularity(flat) < crowd.popularity(growing) <= 1
    assert crowd.popularity([]) is None


def test_evident_volume_levels():
    assert crowd.evident(0, 200) == 1.0 and crowd.evident(30, 200) == 0.0 and crowd.evident(None, 200) == 0.0
    assert crowd.volume(3_000, [1_000] * 10) == 1.0
    assert crowd.volume(1_000, [1_000] * 10) == 0.0
    assert crowd.volume(1_000, [1_000] * 3) == 0.5  # too little history: neutral
    assert crowd.levels(158.37, 162.11) == 0.6
    assert crowd.levels(158.5, 162.0) == 1.0


def test_score_is_five_times_the_weighted_mean_and_ignores_missing():
    cfg = crowd.load_config()
    assert crowd.score({k: 1.0 for k in cfg["weights"]}, cfg, ghost_trades=20) == 5.0
    assert crowd.score({"popularite": 0.0, "evident": 0.0, "volume": 0.0, "niveaux": 0.0}, cfg) == 0.0
    # "mesure" weighs nothing before the ghost has traded
    assert crowd.score({"evident": 1.0, "mesure": 0.0}, cfg, ghost_trades=0) == 5.0
