"""HIVE-602 live-theater endpoint tests: /api/home/activity + its clients.

Reuses the RS256/JWKS stubbing from test_summary (same app instance)."""
import asyncio

import httpx

from app import clients
from app.cache import widget_cache

# Reuse the token/JWKS machinery (the autouse fixture there applies per-module,
# so import the helpers and re-declare the fixture via pytest plugins pattern).
from tests.test_summary import _auth, _stub_jwks, _token, client  # noqa: F401


def _run(coro):
    return asyncio.run(coro)


def _mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---- endpoint --------------------------------------------------------------

def test_activity_requires_auth():
    widget_cache.clear()
    assert client.get("/api/home/activity").status_code == 401


def test_activity_returns_feed_and_agents(monkeypatch):
    widget_cache.clear()
    from app.schema import Widget

    async def _fake_feed(_client, _bearer, org_ids=None, since=None, limit=60):
        return Widget.ok_(data=[{"type": "comment", "at": "2026-07-10T00:00:00Z",
                                 "item_key": "PLAT-1", "excerpt": "hi", "org_id": 1}])

    async def _fake_agents(_client, _bearer):
        return Widget.ok_(data=[{"name": "Rei", "status": "running", "teams": ["review"]}])

    monkeypatch.setattr("app.main.fetch_live_feed", _fake_feed)
    monkeypatch.setattr("app.main.fetch_agents_live", _fake_agents)
    resp = client.get("/api/home/activity", headers=_auth(_token()))
    assert resp.status_code == 200
    body = resp.json()
    assert body["widgets"]["feed"]["status"] == "ok"
    assert body["widgets"]["feed"]["data"][0]["item_key"] == "PLAT-1"
    assert body["widgets"]["agents"]["data"][0]["name"] == "Rei"


def test_activity_foreign_org_is_403(monkeypatch):
    widget_cache.clear()
    resp = client.get("/api/home/activity?org_id=999", headers=_auth(_token()))
    assert resp.status_code == 403


# ---- clients ---------------------------------------------------------------

def test_live_feed_merges_orgs_newest_first():
    def handler(request):
        org = request.url.params.get("organization")
        at = "2026-07-10T02:00:00Z" if org == "1" else "2026-07-10T03:00:00Z"
        return httpx.Response(200, json={"results": [
            {"type": "comment", "at": at, "item_key": f"ORG{org}-1"},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_live_feed(c, "t", org_ids=[1, 2])
    w = _run(go())
    assert w.status == "ok"
    assert [e["item_key"] for e in w.data] == ["ORG2-1", "ORG1-1"]  # newest first
    assert w.data[0]["org_id"] == 2


def test_live_feed_since_is_forwarded():
    seen = {}
    def handler(request):
        seen["since"] = request.url.params.get("since")
        return httpx.Response(200, json={"results": []})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_live_feed(c, "t", org_ids=[1],
                                                 since="2026-07-10T00:00:00Z")
    w = _run(go())
    assert seen["since"] == "2026-07-10T00:00:00Z"
    assert w.status == "empty"


def test_agents_live_maps_fields_and_leads_with_working():
    def handler(request):
        return httpx.Response(200, json={"results": [
            {"agent_username": "akira", "display_name": "Akira", "role": "Security",
             "email": "akira@x", "team_names": ["security"], "effective_model": "gpt-5.5",
             "runtime_harness": "Codex", "status": "stopped", "enabled": False},
            {"agent_username": "rei", "display_name": "Rei", "role": "Reviewer",
             "email": "rei@x", "team_names": ["review"], "effective_model": "qwen",
             "runtime_harness": "Shizuha CLI", "status": "running", "enabled": True},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_agents_live(c, "t")
    w = _run(go())
    assert w.status == "ok"
    assert w.data[0]["name"] == "Rei"          # running first
    assert w.data[0]["model"] == "qwen"
    assert w.data[1]["status"] == "stopped"


def test_agents_live_unauthorized_on_403():
    def handler(request):
        return httpx.Response(403, json={})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_agents_live(c, "t")
    assert _run(go()).status == "unauthorized"


# ---- cockpit drill-downs -----------------------------------------------------

def test_agent_peek_endpoint(monkeypatch):
    widget_cache.clear()
    from app.schema import Widget

    async def _fake_peek(_client, _bearer, email):
        assert email == "rei@shizuha.com"
        return Widget.ok_(data={"tasks": [{"key": "PLAT-1"}], "events": []})

    monkeypatch.setattr("app.main.fetch_agent_peek", _fake_peek)
    resp = client.get("/api/home/agent?email=rei@shizuha.com", headers=_auth(_token()))
    assert resp.status_code == 200
    assert resp.json()["widget"]["data"]["tasks"][0]["key"] == "PLAT-1"


def test_org_map_foreign_org_403():
    widget_cache.clear()
    assert client.get("/api/home/org-map?org_id=999",
                      headers=_auth(_token())).status_code == 403


def test_task_peek_endpoint(monkeypatch):
    widget_cache.clear()
    from app.schema import Widget

    async def _fake_task(_client, _bearer, key):
        return Widget.ok_(data={"item": {"key": key, "title": "T"},
                                "activity": [], "comments": []})

    monkeypatch.setattr("app.main.fetch_task_peek", _fake_task)
    resp = client.get("/api/home/task?key=HIVE-602", headers=_auth(_token()))
    assert resp.status_code == 200
    assert resp.json()["widget"]["data"]["item"]["key"] == "HIVE-602"


def test_task_peek_client_rejects_mismatched_row():
    # item_key param unsupported downstream → unrelated first page row must
    # never render as the requested task.
    def handler(request):
        if "activity-feed" in str(request.url):
            return httpx.Response(200, json={"results": []})
        return httpx.Response(200, json={"results": [
            {"id": 1, "item_key": "OTHER-9", "title": "wrong"},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_task_peek(c, "t", "HIVE-602")
    assert _run(go()).status == "empty"
