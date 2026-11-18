"""The watcher's API, for the passes (scope "claude").

PILE_API_URL: the watcher's address (environment variable of the Claude
environment). The token never reaches this code in the scheduled passes: the
environment's network secret makes the proxy add the Authorization header.
PILE_API_TOKEN is read only for a run on a developer machine.
"""

import json
import os
import urllib.error
import urllib.request

UA = "pile-ops/1"


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__("%s %s: %s" % (status, code, message))
        self.status = status
        self.code = code


class Api:
    def __init__(self, base=None, token=None, opener=None):
        self.base = (base or os.environ.get("PILE_API_URL") or "").rstrip("/")
        if not self.base.startswith("https://"):
            raise ApiError(0, "config", "PILE_API_URL manquant ou pas en https")
        self.token = token if token is not None else os.environ.get("PILE_API_TOKEN")
        self.open = opener or urllib.request.urlopen

    def _call(self, method, path, body=None, timeout=60):
        headers = {"Accept": "application/json", "User-Agent": UA}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.open(req, timeout=timeout) as r:
                raw = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
        except urllib.error.URLError as e:
            raise ApiError(0, "network", str(e.reason))
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            parsed = None
        if status >= 400 and status != 422:
            err = (parsed or {}).get("error") or {}
            raise ApiError(status, err.get("code", "http"), err.get("message", "HTTP %d" % status))
        return parsed

    def state(self):
        return self._call("GET", "/api/state")

    def plans(self, date=None):
        return self._call("GET", "/api/plans" + ("?date=" + date if date else ""))

    def post_plans(self, body):
        return self._call("POST", "/api/plans", body)

    def journal(self, date):
        return self._call("GET", "/api/journal?date=" + date)

    def post_journal(self, entry):
        return self._call("POST", "/api/journal", entry)

    def post_pass(self, name, status, detail=None):
        body = {"pass": name, "status": status}
        if detail:
            body["detail"] = detail[:500]
        return self._call("POST", "/api/passes", body)

    def post_alert(self, level, code, message):
        return self._call("POST", "/api/alerts", {"level": level, "code": code, "message": message[:500]})

    def crowd(self):
        return self._call("GET", "/api/crowd")

    def post_crowd(self, date, score, components):
        return self._call("POST", "/api/crowd", {"date": date, "score": score, "components": components})

    def bars(self, symbols, timeframe, start, end=None, page_token=None):
        q = "symbols=%s&timeframe=%s&start=%s" % (",".join(symbols), timeframe, start)
        if end:
            q += "&end=" + end
        if page_token:
            q += "&page_token=" + urllib.request.quote(page_token, safe="")
        return self._call("GET", "/api/bars?" + q, timeout=120)
