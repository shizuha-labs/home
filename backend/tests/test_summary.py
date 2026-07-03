"""HIVE-375 slice-1 tests: auth/tenant-scope (PLAT-1236 cross-org→403) + the
pulse client's graceful degradation. Runnable offline (TestClient + httpx
MockTransport) — no live downstream needed.
"""
import asyncio
import datetime
import os

# Must be set BEFORE importing the app (config reads it at import).
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-hive375")

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from app import clients
from app.config import settings
from app.main import app

client = TestClient(app)
SECRET = settings.JWT_SECRET_KEY


def _token(user_id=101, email="a@org1.example", memberships=None, expired=False):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "user_id": user_id,
        "email": email,
        "organization_memberships": memberships if memberships is not None else {"1": "admin"},
        "exp": now - datetime.timedelta(hours=1) if expired else now + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True)
def _stub_widgets(monkeypatch):
    """Stub the pulse fan-out for auth/envelope tests (clients are tested
    separately below). Returns ok widgets so the envelope is well-formed."""
    async def _fake_tasks(_client, _bearer, _email, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data={"open": 3, "in_progress": 1, "in_review": 0, "blocked": 0, "awaiting_merge": 0})
    async def _fake_agents(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data={"active": 2, "error": 1})
    async def _fake_alerts(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data=[{"sev": "high", "summary": "Probe failing"}])
    monkeypatch.setattr("app.main.fetch_tasks_by_status", _fake_tasks)
    monkeypatch.setattr("app.main.fetch_agent_activity", _fake_agents)
    monkeypatch.setattr("app.main.fetch_alerts", _fake_alerts)


# ---- auth / tenant scope (the load-bearing isolation control) --------------
def test_no_token_is_401():
    assert client.get("/api/home/summary").status_code == 401


def test_garbage_token_is_401():
    assert client.get("/api/home/summary", headers=_auth("not.a.jwt")).status_code == 401


def test_expired_token_is_401():
    assert client.get("/api/home/summary", headers=_auth(_token(expired=True))).status_code == 401


def test_token_signed_with_wrong_key_is_401():
    forged = jwt.encode({"user_id": 1, "organization_memberships": {"1": "admin"}}, "attacker-key", algorithm="HS256")
    assert client.get("/api/home/summary", headers=_auth(forged)).status_code == 401


def test_valid_token_returns_scoped_summary():
    r = client.get("/api/home/summary", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert {o["id"] for o in body["orgs"]} == {1, 7}
    assert body["widgets"]["tasks_by_status"]["status"] == "ok"
    assert body["widgets"]["agent_activity"]["data"] == {"active": 2, "error": 1}
    assert body["widgets"]["alerts"]["data"][0]["sev"] == "high"


def test_requesting_own_org_is_allowed():
    r = client.get("/api/home/summary?org_id=7", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    assert r.json()["org_id"] == 7


def test_requesting_foreign_org_is_403():
    """PLAT-1236: a caller must never receive another org's summary, even by
    guessing the id — org_id not in the signed memberships → 403."""
    r = client.get("/api/home/summary?org_id=999", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 403


def test_orgs_come_from_token_not_request():
    """Scope is derived only from the verified claim — a member of org 1 only
    never sees org 2 in their orgs list."""
    body = client.get("/api/home/summary", headers=_auth(_token(memberships={"1": "admin"}))).json()
    assert {o["id"] for o in body["orgs"]} == {1}


# ---- pulse client: graceful degradation + forwarding ------------------------
def _run(coro):
    return asyncio.run(coro)


def _mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_tasks_widget_counts_by_status():
    def handler(request):
        # The caller's Bearer must be forwarded verbatim (no privileged token).
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        assert request.url.params.get("organization") == "7"
        assert "org_id" not in request.url.params
        return httpx.Response(200, json={"results": [
            {"status": "open"}, {"status": "open"}, {"status": "in_review"}, {"status": "done"},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_tasks_by_status(c, "caller-tok", "a@org1.example", 7)
    w = _run(go())
    assert w.status == "ok"
    assert w.data["open"] == 2 and w.data["in_review"] == 1


def test_tasks_widget_degrades_on_timeout():
    def handler(request):
        raise httpx.ConnectTimeout("boom")
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_tasks_by_status(c, "t", "a@org1.example")
    w = _run(go())
    assert w.status == "degraded"  # one source down → widget degraded, never a 500


def test_tasks_widget_unauthorized_on_403():
    def handler(request):
        return httpx.Response(403, json={"detail": "forbidden"})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_tasks_by_status(c, "t", "a@org1.example")
    assert _run(go()).status == "unauthorized"


def test_agent_activity_widget_disabled_until_pulse_endpoint_is_scoped():
    def handler(request):
        raise AssertionError("unscoped Pulse agent_overview must not be called")
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_agent_activity(c, "caller-tok", 7)
    w = _run(go())
    assert w.status == "degraded"
    assert w.data == {"active": None, "error": None}


def test_alerts_widget_returns_compact_severity_summaries():
    def handler(request):
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        assert request.url.params.get("organization") == "7"
        assert "org_id" not in request.url.params
        return httpx.Response(200, json={"alerts": [
            {"severity": "critical", "summary": "Node CPU high"},
            {"priority": "high", "title": "Agent down"},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_alerts(c, "caller-tok", 7)
    w = _run(go())
    assert w.status == "ok"
    assert w.data == [
        {"sev": "critical", "summary": "Node CPU high"},
        {"sev": "high", "summary": "Agent down"},
    ]


def test_alerts_widget_empty_when_no_active_alerts():
    def handler(request):
        return httpx.Response(200, json={"alerts": []})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_alerts(c, "t")
    assert _run(go()).status == "empty"
