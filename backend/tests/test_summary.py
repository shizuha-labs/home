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
from app.cache import widget_cache
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
    """Stub fan-outs for auth/envelope tests (clients are tested
    separately below). Returns ok widgets so the envelope is well-formed."""
    widget_cache.clear()
    async def _fake_tasks(_client, _bearer, _email, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data={"open": 3, "in_progress": 1, "in_review": 0, "blocked": 0, "awaiting_merge": 0})
    async def _fake_agents(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data={"active": 2, "error": 1})
    async def _fake_alerts(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data=[{"sev": "high", "summary": "Probe failing"}])
    async def _fake_financial(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data={"cash": 1200.0, "period_net": 345.0})
    async def _fake_conversations(_client, _bearer, _org_id=None):
        from app.schema import Widget
        return Widget.ok_(data=[{"id": "c1", "title": "Ops", "unread": 2}])
    monkeypatch.setattr("app.main.fetch_tasks_by_status", _fake_tasks)
    monkeypatch.setattr("app.main.fetch_agent_activity", _fake_agents)
    monkeypatch.setattr("app.main.fetch_alerts", _fake_alerts)
    monkeypatch.setattr("app.main.fetch_financial_snapshot", _fake_financial)
    monkeypatch.setattr("app.main.fetch_recent_conversations", _fake_conversations)


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
    assert body["widgets"]["financial_snapshot"]["data"]["cash"] == 1200.0
    assert body["widgets"]["recent_conversations"]["data"][0]["title"] == "Ops"


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


# ---- Books / Connect client widgets ----------------------------------------
def test_financial_snapshot_uses_books_org_header_and_compacts_dashboard():
    def handler(request):
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        assert request.headers.get("X-Organization-ID") == "7"
        return httpx.Response(200, json={
            "company": {"name": "Global"},
            "summary": {
                "total_cash": "1234.50",
                "receivables": {"amount": "100.00"},
                "payables": {"amount": "25.50"},
            },
            "period_summary": {"income": "900", "expenses": "400", "net": "500"},
        })
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_financial_snapshot(c, "caller-tok", 7)
    w = _run(go())
    assert w.status == "ok"
    assert w.data == {
        "company": "Global", "currency": "INR", "cash": 1234.5,
        "receivables": 100.0, "payables": 25.5,
        "period_net": 500.0, "period_income": 900.0, "period_expenses": 400.0,
    }


def test_financial_snapshot_unauthorized_on_books_403():
    def handler(request):
        return httpx.Response(403, json={"detail": "forbidden"})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_financial_snapshot(c, "caller-tok", 7)
    assert _run(go()).status == "unauthorized"


def test_financial_snapshot_empty_without_selected_org():
    async def go():
        async with _mock_client(lambda request: httpx.Response(500)) as c:
            return await clients.fetch_financial_snapshot(c, "caller-tok", None)
    assert _run(go()).status == "empty"


def test_recent_conversations_compacts_visible_connect_rows():
    def handler(request):
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        assert request.url.params.get("page_size") == "5"
        return httpx.Response(200, json=[{
            "id": "conv-1",
            "conversation_type": "direct",
            "participant_names": ["Kai"],
            "unread_count": 3,
            "last_message_at": "2026-07-03T12:00:00Z",
            "last_message_preview": "Please review",
        }])
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_recent_conversations(c, "caller-tok", None)
    w = _run(go())
    assert w.status == "ok"
    assert w.data == [{
        "id": "conv-1", "title": "Kai", "type": "direct", "unread": 3,
        "last_at": "2026-07-03T12:00:00Z", "last_preview": "Please review",
    }]



def test_recent_conversations_degrades_for_selected_org_until_connect_is_scoped():
    def handler(request):
        raise AssertionError("unscoped Connect conversations must not be called for selected org")
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_recent_conversations(c, "caller-tok", 7)
    w = _run(go())
    assert w.status == "degraded"
    assert w.data == []


def test_widget_cache_does_not_serve_stale_over_unauthorized(monkeypatch):
    from app.schema import Widget
    from app.cache import WidgetCache

    cache = WidgetCache()
    calls = {"n": 0}

    async def fetch():
        calls["n"] += 1
        if calls["n"] == 1:
            return Widget.ok_(data={"cash": 1234.5})
        return Widget.unauthorized_()

    monkeypatch.setattr(settings, "CACHE_TTL_SECONDS", 0)
    monkeypatch.setattr(settings, "STALE_TTL_SECONDS", 60)

    first = _run(cache.get_or_fetch("financial:u=1:org=7", fetch))
    second = _run(cache.get_or_fetch("financial:u=1:org=7", fetch))
    assert first.status == "ok"
    assert second.status == "unauthorized"
    assert second.data is None


def test_financial_cache_revalidates_books_authz_inside_fresh_ttl(monkeypatch):
    from app.schema import Widget
    from app.cache import WidgetCache

    cache = WidgetCache()
    calls = {"n": 0}

    async def fetch():
        calls["n"] += 1
        if calls["n"] == 1:
            return Widget.ok_(data={"cash": 1234.5})
        return Widget.unauthorized_()

    monkeypatch.setattr(settings, "CACHE_TTL_SECONDS", 15)
    monkeypatch.setattr(settings, "STALE_TTL_SECONDS", 60)

    first = _run(cache.get_or_fetch("financial:u=1:org=7", fetch, cache_fresh=False))
    second = _run(cache.get_or_fetch("financial:u=1:org=7", fetch, cache_fresh=False))
    assert calls["n"] == 2
    assert first.status == "ok"
    assert second.status == "unauthorized"
    assert second.data is None


def test_widget_cache_serves_stale_after_source_failure(monkeypatch):
    from app.schema import Widget
    from app.cache import WidgetCache

    cache = WidgetCache()
    calls = {"n": 0}

    async def fetch():
        calls["n"] += 1
        if calls["n"] == 1:
            return Widget.ok_(data={"open": 1})
        return Widget.degraded_(data={"open": None})

    monkeypatch.setattr(settings, "CACHE_TTL_SECONDS", 0)
    monkeypatch.setattr(settings, "STALE_TTL_SECONDS", 60)

    first = _run(cache.get_or_fetch("tasks:u=1:org=7", fetch))
    second = _run(cache.get_or_fetch("tasks:u=1:org=7", fetch))
    assert first.status == "ok"
    assert second.status == "stale"
    assert second.data == {"open": 1}
