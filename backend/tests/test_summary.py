"""HIVE-375 slice-1 tests: auth/tenant-scope (PLAT-1236 cross-org→403) + the
pulse client's graceful degradation. Runnable offline (TestClient + httpx
MockTransport) — no live downstream needed.
"""
import asyncio
import datetime
import os

# Must be set BEFORE importing the app (config reads it at import).
os.environ.setdefault("SHIZUHA_JWKS_URL", "https://id.test/.well-known/jwks.json")

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth, clients
from app.cache import widget_cache
from app.config import settings
from app.main import app

client = TestClient(app)
_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()


def _token(user_id=101, email="a@org1.example", memberships=None, expired=False, key=None, kid="test-kid", alg="RS256"):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "user_id": user_id,
        "email": email,
        "organization_memberships": memberships if memberships is not None else {"1": "admin"},
        "exp": now - datetime.timedelta(hours=1) if expired else now + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, key or _PRIVATE_KEY, algorithm=alg, headers={"kid": kid} if kid else None)


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch):
    # HEAD auth.py verifies RS256 via _jwks_fetch_keys() -> {kid: public_key};
    # stub it to our in-memory test key so RS256 tests never hit the network.
    def _fake_fetch(force_refresh=False):
        return {"test-kid": _PUBLIC_KEY}
    monkeypatch.setattr("app.auth._jwks_fetch_keys", _fake_fetch)
    auth._JWKS_CACHE["keys"] = {}
    auth._JWKS_CACHE["fetched_at"] = 0.0
    yield
    auth._JWKS_CACHE["keys"] = {}
    auth._JWKS_CACHE["fetched_at"] = 0.0


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
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = _token(user_id=1, memberships={"1": "admin"}, key=attacker_key)
    assert client.get("/api/home/summary", headers=_auth(forged)).status_code == 401


def test_hs256_token_is_rejected():
    forged = jwt.encode({"user_id": 1, "organization_memberships": {"1": "admin"}}, "attacker-key", algorithm="HS256")
    assert client.get("/api/home/summary", headers=_auth(forged)).status_code == 401


def test_unknown_kid_is_rejected():
    assert client.get("/api/home/summary", headers=_auth(_token(kid="missing"))).status_code == 401


def test_valid_token_returns_scoped_summary():
    r = client.get("/api/home/summary", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert {o["id"] for o in body["orgs"]} == {1, 7}
    assert all(o["name"] is not None for o in body["orgs"])
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


def test_org_refs_are_hydrated_from_admin_without_widening_memberships():
    def handler(request):
        assert request.url.path == "/api/internal/users/101/organizations/"
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        return httpx.Response(200, json={"organizations": [
            {"id": 7, "name": "Shizuha Labs", "slug": "shizuha"},
            {"id": 999, "name": "Foreign Org", "slug": "foreign"},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_org_refs(c, "caller-tok", 101, "a@org1.example", {7: "owner"})
    orgs = _run(go())
    assert [getattr(o, "model_dump", o.dict)() for o in orgs] == [{
        "id": 7,
        "role": "owner",
        "name": "Shizuha Labs",
        "slug": "shizuha",
    }]


def test_org_refs_fallback_to_stable_labels_on_admin_failure():
    def handler(request):
        raise httpx.ReadTimeout("boom")
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_org_refs(c, "caller-tok", 101, None, {7: "owner"})
    orgs = _run(go())
    assert orgs[0].name == "Organization 7"


def test_agent_activity_widget_counts_hive_fleet_statuses():
    def handler(request):
        assert request.url.path == "/hive/api/v1/fleet/agents/"
        assert request.headers.get("Authorization") == "Bearer caller-tok"
        assert request.url.params.get("page_size") == "250"
        return httpx.Response(200, json={"results": [
            {"status": "running", "enabled": True},
            {"status": "Alive"},
            {"status": "Unavailable"},
            {"status": "stopped", "enabled": False},
        ]})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_agent_activity(c, "caller-tok", 7)
    w = _run(go())
    assert w.status == "ok"
    assert w.data == {"active": 2, "error": 1, "stopped": 1, "total": 4}


def test_agent_activity_widget_unauthorized_on_hive_403():
    def handler(request):
        return httpx.Response(403, json={"detail": "forbidden"})
    async def go():
        async with _mock_client(handler) as c:
            return await clients.fetch_agent_activity(c, "caller-tok", None)
    assert _run(go()).status == "unauthorized"


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


def test_pyjwt_rsa_backend_available():
    """RS256/JWKS user-token verification needs PyJWT's cryptography backend.

    Without the `cryptography` package RSAAlgorithm is silently absent and
    _jwks_fetch_keys() returns {} — every real shizuha-id token then 401s
    (the 2026-07-05 dashboard 'Couldn't load' incident). Fail loud here.
    """
    import jwt as _jwt

    assert hasattr(_jwt.algorithms, "RSAAlgorithm"), (
        "PyJWT lacks the RSA backend — is 'cryptography' in requirements?"
    )


def test_jwks_url_honors_documented_aliases():
    """HIVE-474 / revi P2: auth.py fetches settings.JWKS_URL, so JWKS_URL MUST
    resolve the DOCUMENTED aliases — an operator who sets SHIZUHA_JWKS_URL (or
    SHIZUHA_ID_JWKS_URL) must actually change the endpoint the verifier fetches,
    in precedence SHIZUHA_OAUTH_JWKS_URL > SHIZUHA_JWKS_URL > SHIZUHA_ID_JWKS_URL.
    Without this the newly documented env was silently ignored (still 401s)."""
    import importlib
    import os as _os
    import app.config as cfg

    keys = ("SHIZUHA_OAUTH_JWKS_URL", "SHIZUHA_JWKS_URL", "SHIZUHA_ID_JWKS_URL")
    saved = {k: _os.environ.get(k) for k in keys}

    def _restore():
        for k, v in saved.items():
            if v is None:
                _os.environ.pop(k, None)
            else:
                _os.environ[k] = v
        importlib.reload(cfg)

    try:
        for k in keys:
            _os.environ.pop(k, None)
        _os.environ["SHIZUHA_ID_JWKS_URL"] = "https://idalias.example/jwks.json"
        importlib.reload(cfg)
        assert cfg.settings.JWKS_URL == "https://idalias.example/jwks.json"

        _os.environ["SHIZUHA_JWKS_URL"] = "https://jwksalias.example/jwks.json"
        importlib.reload(cfg)
        # SHIZUHA_JWKS_URL takes precedence over SHIZUHA_ID_JWKS_URL
        assert cfg.settings.JWKS_URL == "https://jwksalias.example/jwks.json"

        _os.environ["SHIZUHA_OAUTH_JWKS_URL"] = "https://oauth.example/jwks.json"
        importlib.reload(cfg)
        # the Django-canonical override wins over everything
        assert cfg.settings.JWKS_URL == "https://oauth.example/jwks.json"
    finally:
        _restore()
