"""The exact tool calls of the passes, run offline against the skill: a wrong flag fails here, not at 9:15."""
import importlib.util
import os

from conftest import FIX, ROOT
from pile_ops.skill import run

spec = importlib.util.spec_from_file_location("pile_cli", os.path.join(ROOT, "ops", "pile.py"))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def test_daily_scan_call(tmp_path):
    (tmp_path / "trader").mkdir()
    code, out, err = run("scan", cli.DAILY_ARGS + ["--offline", os.path.join(FIX, "trader-scanner", "daily-spark-2026-10-19.json"), "--now", "2026-10-19 09:15"], str(tmp_path))
    assert code == 0 and out["hits"], err


def test_news_call(tmp_path):
    (tmp_path / "trader").mkdir()
    args = cli.news_args(["TSLA", "AAPL"], 20, sec=False) + ["--no-moves", "--offline", os.path.join(FIX, "trader-news"), "--now", "2026-10-19T14:00:00Z"]
    code, out, err = run("news", args, str(tmp_path), ok_codes=(0, 1))
    assert out and out["items"] and {"ticker", "tags", "title"} <= set(out["items"][0]), err


def test_tags_of_flags_restatements():
    items = [{"kind": "filing", "items": ["4.02"], "tags": []}, {"kind": "headline", "tags": ["earnings"]}]
    assert cli.tags_of(items) == {"restatement", "earnings"}
    assert cli.BAD_TAGS & cli.tags_of(items) == {"restatement", "earnings"}
