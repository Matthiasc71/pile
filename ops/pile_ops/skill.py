"""Calls into the vendored day-trader-skill, never modified (rule 0.5).

Each tool runs as its own process in a work folder (trader/ under it), with
--json, and its output is parsed. One 60-day 5-minute chart per symbol is
downloaded once and handed to entry, exit and the Time Machine (--offline):
fewer requests, the same bars for every tool, and one place for the fallback
(IEX bars relayed by the watcher) when Yahoo is blocked.
"""

import datetime
import gzip
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS = os.path.join(ROOT, ".claude", "skills")
NY = ZoneInfo("America/New_York") if ZoneInfo else None
# Same identification the skill's own tools use.
UA = "Mozilla/5.0 (compatible; day-trader-skill/2.0; +https://github.com/Jakeschincariol/day-trader-skill)"

TOOLS = {
    "scan": "trader-scanner/scan.py",
    "news": "trader-news/news.py",
    "entry": "trader-entry/entry.py",
    "exit": "trader-exit/exit.py",
    "timemachine": "trader-timemachine/timemachine.py",
    "budget": "trader-budget/size.py",
    "risk": "trader-risk/check.py",
}


class SkillError(Exception):
    pass


def run(tool, args, workdir, timeout=900, ok_codes=(0,)):
    """Run one skill tool with --json; return (exit code, parsed JSON or None, stderr tail)."""
    path = os.path.join(SKILLS, TOOLS[tool])
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    try:
        p = subprocess.run([sys.executable, path] + list(args), cwd=workdir, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise SkillError("%s: plus de %d s" % (tool, timeout))
    parsed = None
    out = p.stdout.strip()
    if out:
        try:
            parsed = json.loads(out)
        except ValueError:
            parsed = None
    err = p.stderr.strip()[-600:]
    if p.returncode not in ok_codes and parsed is None:
        raise SkillError("%s %s : code %d. %s" % (tool, " ".join(args[:2]), p.returncode, err))
    return p.returncode, parsed, err


def ny_now():
    return datetime.datetime.now(NY)


# ---------------------------------------------------------------- charts

def chart_url(symbol, host="query2"):
    return "https://%s.finance.yahoo.com/v8/finance/chart/%s?range=60d&interval=5m" % (host, symbol.replace(".", "-"))


def fetch_yahoo_chart(symbol, opener=urllib.request.urlopen, tries=2):
    last = None
    for i in range(tries):
        for host in ("query2", "query1"):
            try:
                req = urllib.request.Request(chart_url(symbol, host), headers={"User-Agent": UA, "Accept": "application/json"})
                with opener(req, timeout=30) as r:
                    data = json.loads(r.read().decode("utf-8"))
                res = (data.get("chart") or {}).get("result") or []
                if res and res[0].get("timestamp"):
                    return data
                last = "réponse vide"
            except (urllib.error.URLError, ValueError, OSError) as e:
                last = str(e)
        time.sleep(1 + i)
    raise SkillError("Yahoo %s : %s" % (symbol, last))


def chart_from_iex(symbol, bars, previous_close=None):
    """A Yahoo-shaped chart from Alpaca IEX 5-minute bars (fallback). Volume is IEX only."""
    ts, o, h, l, c, v = [], [], [], [], [], []
    for b in bars:
        t = datetime.datetime.strptime(b["t"].replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")
        local = t.astimezone(NY)
        if not (datetime.time(9, 30) <= local.time() < datetime.time(16, 0)):
            continue
        ts.append(int(t.timestamp()))
        o.append(b["o"]), h.append(b["h"]), l.append(b["l"]), c.append(b["c"]), v.append(int(b["v"]))
    meta = {
        "symbol": symbol,
        "currency": "USD",
        "exchangeTimezoneName": "America/New_York",
        "dataGranularity": "5m",
        "regularMarketTime": ts[-1] if ts else None,
        "regularMarketPrice": c[-1] if c else None,
        "previousClose": previous_close,
        "source": "alpaca-iex (repli)",
    }
    return {"chart": {"result": [{"meta": meta, "timestamp": ts, "indicators": {"quote": [{"open": o, "high": h, "low": l, "close": c, "volume": v}]}}], "error": None}}


def fetch_iex_chart(api, symbol, days=62):
    start = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    bars, token = [], None
    for _ in range(5):
        page = api.bars([symbol], "5Min", start, page_token=token)
        bars += (page.get("bars") or {}).get(symbol, [])
        token = page.get("next_page_token")
        if not token:
            break
    if not bars:
        raise SkillError("IEX %s : aucune barre" % symbol)
    return chart_from_iex(symbol, bars)


def save_chart(chart, path):
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(chart, fh)
    return path


def load_chart(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def bars_of(chart):
    """[{t (New York datetime), o, h, l, c, v}] from a Yahoo chart, nulls skipped."""
    r = chart["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    out = []
    for i, t in enumerate(r["timestamp"]):
        vals = [q[k][i] for k in ("open", "high", "low", "close", "volume")]
        if any(x is None for x in vals[:4]):
            continue
        out.append({"t": datetime.datetime.fromtimestamp(t, NY), "o": vals[0], "h": vals[1], "l": vals[2], "c": vals[3], "v": vals[4] or 0})
    return out


def opening_volumes(bars, day, minutes=15):
    """Opening-range volume of `day` and of each earlier session (same 9:30 + minutes window)."""
    end = datetime.time(9, 30 + minutes) if minutes < 30 else datetime.time(10, 0)
    by_day = {}
    for b in bars:
        if datetime.time(9, 30) <= b["t"].time() < end:
            by_day.setdefault(b["t"].date(), 0)
            by_day[b["t"].date()] += b["v"]
    today = by_day.pop(day, None)
    past = [v for d, v in sorted(by_day.items()) if d < day][-20:]
    return today, past
