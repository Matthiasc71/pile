import io
import json
import urllib.error

import pytest

from pile_ops.api import Api, ApiError


class Resp(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(json.dumps(body).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_needs_https_base(monkeypatch):
    monkeypatch.delenv("PILE_API_URL", raising=False)
    with pytest.raises(ApiError):
        Api()
    with pytest.raises(ApiError):
        Api(base="http://pile.example")


def test_no_token_header_unless_given():
    seen = []

    def opener(req, timeout):
        seen.append(dict(req.header_items()))
        return Resp({"ok": True})

    Api(base="https://pile.example", token="", opener=opener).state()
    assert "Authorization" not in seen[0]
    Api(base="https://pile.example", token="pile_x", opener=opener).state()
    assert seen[1]["Authorization"] == "Bearer pile_x"


def test_errors_carry_the_watcher_message():
    def opener(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 403, "x", {}, io.BytesIO(b'{"error":{"code":"forbidden","message":"portee insuffisante"}}'))

    with pytest.raises(ApiError) as e:
        Api(base="https://pile.example", token="", opener=opener).post_plans({})
    assert e.value.status == 403 and "portee" in str(e.value)


def test_422_plan_refusals_are_returned_not_raised():
    def opener(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 422, "x", {}, io.BytesIO(b'{"accepted":[],"rejected":[{"id":"a","reason":"b"}],"disarmed":[]}'))

    r = Api(base="https://pile.example", token="", opener=opener).post_plans({})
    assert r["rejected"][0]["reason"] == "b"
