import os
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import check_paper_lock as lock  # noqa: E402

LIVE = "api" + ".alpaca" + ".markets"
PAPER = "paper-" + LIVE


@pytest.mark.parametrize("text", [
    "https://" + LIVE + "/v2/orders",
    "base = '" + LIVE + "'",
    "https://broker-" + LIVE,
    "https://www." + LIVE,
    "HTTPS://" + LIVE.upper(),
    "url=https://" + LIVE + " and https://" + PAPER,
])
def test_live_host_is_refused(text):
    assert lock.offences(text)


@pytest.mark.parametrize("text", [
    "https://" + PAPER + "/v2/account",
    "const PAPER_BASE = \"https://" + PAPER + "\";",
    "https://data.alpaca.markets/v2/stocks/bars",
    "https://docs.alpaca.markets/docs/fractional-trading",
    "alpaca.markets",
])
def test_paper_and_other_hosts_pass(text):
    assert lock.offences(text) == []


def test_scan_finds_the_file_and_line():
    with tempfile.TemporaryDirectory() as root:
        with open(os.path.join(root, "ok.ts"), "w") as fh:
            fh.write("https://" + PAPER + "\n")
        with open(os.path.join(root, "bad.md"), "w") as fh:
            fh.write("line one\nsee https://" + LIVE + "\n")
        hits = lock.scan(root)
        assert [(p, n) for p, n, _ in hits] == [("bad.md", 2)]
        assert lock.main(["x", root]) == 1


def test_this_repository_is_clean():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    assert lock.scan(root) == []


def test_cli_exit_code():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    r = subprocess.run([sys.executable, os.path.join(root, "scripts", "check_paper_lock.py"), root])
    assert r.returncode == 0
