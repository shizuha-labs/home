"""Live / voice browser traces: ingest, sanitize, tenant isolation, Connect join."""
import datetime
import json
import os

os.environ.setdefault("SHIZUHA_JWKS_URL", "https://id.test/.well-known/jwks.json")

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth
from app.live_trace import clear_rate_for_tests, sanitize_event
from app.main import app

client = TestClient(app)
_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()


def _token(user_id=101, email="a@org1.example", memberships=None):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "user_id": user_id,
        "email": email,
        "organization_memberships": memberships if memberships is not None else {"1": "admin"},
        "exp": now + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, _PRIVATE_KEY, algorithm="RS256", headers={"kid": "test-kid"})


def _auth(user_id=101):
    return {"Authorization": f"Bearer {_token(user_id=user_id)}"}


class FakeRedis:
    def __init__(self):
        self.streams = {}

    async def xadd(self, key, fields, maxlen=None, approximate=True):
        rows = self.streams.setdefault(key, [])
        stream_id = f"{len(rows) + 1}-0"
        rows.append((stream_id, dict(fields)))
        if maxlen and len(rows) > maxlen:
            del rows[0:len(rows) - maxlen]
        return stream_id

    async def xrevrange(self, key, max="+", min="-", count=None):
        rows = list(reversed(self.streams.get(key, [])))
        if count is not None:
            rows = rows[:count]
        return rows

    async def expire(self, key, seconds):
        return True


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    def _fake_fetch(force_refresh=False):
        return {"test-kid": _PUBLIC_KEY}

    monkeypatch.setattr("app.auth._jwks_fetch_keys", _fake_fetch)
    auth._JWKS_CACHE["keys"] = {}
    fake = FakeRedis()

    async def _get_redis():
        return fake

    monkeypatch.setattr("app.live_trace.get_redis", _get_redis)
    clear_rate_for_tests()
    return fake


def test_sanitize_drops_tokens_and_bad_names():
    kept = sanitize_event({
        "name": "ui.click",
        "ts": "2026-08-16T17:00:00Z",
        "call_id": "abc123",
        "attrs": {"token": "secret", "label": "Voice replies off"},
    }, 7)
    assert kept["name"] == "ui.click"
    assert kept["user_id"] == 7
    assert "token" not in kept["attrs"]
    assert kept["attrs"]["label"] == "Voice replies off"
    assert sanitize_event({"name": "DROP ME", "ts": "2026-08-16T17:00:00Z"}, 7) is None


def test_ingest_and_read_own_timeline(_stub):
    ev = {
        "name": "call.begin",
        "ts": "2026-08-16T17:00:00.000Z",
        "seq": 1,
        "session_id": "sess1",
        "call_id": "callaa11",
        "trace_id": "tracebb22",
        "conversation_id": "bb516974-4152-427a-a2ac-04535b5f393f",
        "attrs": {"agent": "ena"},
    }
    posted = client.post("/api/home/live-trace", headers=_auth(101), json={"events": [ev]})
    assert posted.status_code == 200
    assert posted.json()["accepted"] == 1

    other = client.get("/api/home/live-trace", headers=_auth(202), params={"include_messages": False})
    assert other.status_code == 200
    assert other.json()["events"] == []

    mine = client.get(
        "/api/home/live-trace",
        headers=_auth(101),
        params={"conversation_id": ev["conversation_id"], "include_messages": False},
    )
    assert mine.status_code == 200
    body = mine.json()
    assert body["user_id"] == 101
    assert len(body["events"]) == 1
    assert body["events"][0]["name"] == "call.begin"
    assert body["events"][0]["call_id"] == "callaa11"


def test_unauthenticated_ingest_is_401():
    res = client.post("/api/home/live-trace", json={"events": [{"name": "call.begin", "ts": "t"}]})
    assert res.status_code == 401


def test_timeline_joins_connect_messages(monkeypatch, _stub):
    ev = {
        "name": "chat.send",
        "ts": "2026-08-16T17:00:01.000Z",
        "seq": 2,
        "conversation_id": "bb516974-4152-427a-a2ac-04535b5f393f",
        "attrs": {"text": "lantern story"},
    }
    assert client.post("/api/home/live-trace", headers=_auth(101), json={"events": [ev]}).status_code == 200

    async def fake_messages(bearer, conversation_id, limit=80):
        assert conversation_id == ev["conversation_id"]
        return [{
            "name": "connect.message",
            "ts": "2026-08-16T17:00:03.000Z",
            "source": "connect",
            "conversation_id": conversation_id,
            "attrs": {"text": "A lantern sat on the porch.", "sender": "Ena"},
        }]

    monkeypatch.setattr("app.main.fetch_connect_messages", fake_messages)
    res = client.get(
        "/api/home/live-trace",
        headers=_auth(101),
        params={"conversation_id": ev["conversation_id"], "include_messages": True},
    )
    assert res.status_code == 200
    names = [e["name"] for e in res.json()["events"]]
    assert names == ["chat.send", "connect.message"]
