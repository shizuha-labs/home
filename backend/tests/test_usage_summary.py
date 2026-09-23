"""PLAT-9402 Slice-B regression: the /api/usage/summary HANDLER mapping.

The #48 premerge suite covered the client function (fetch_usage_summary) but
never the handler's WidgetStatus mapping — the handler shipped checking
WidgetStatus.UNAUTHORIZED / .OK (uppercase; the enum members are lowercase),
so every authenticated request raised AttributeError -> a bare HTTP 500
text/plain on prod (live-caught by the two-account acceptance leg, 09-20).
The unauthenticated path 401s inside verify_caller before reaching the
mapping, which is why the deployment smoke (401 JSON) passed while the
authenticated surface was broken.

These tests drive the real handler through TestClient with the downstream
httpx client stubbed, asserting the contract: core 4xx -> typed 401/502 JSON
(never a 500), core 200 -> 200 with the payload verbatim.
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

from app import auth
from app.main import app

client = TestClient(app)
_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()


def _token(user_id=129, email="saki@shizuha.com"):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "user_id": user_id,
        "email": email,
        "organization_memberships": {"1": "member"},
        "exp": now + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, _PRIVATE_KEY, algorithm="RS256", headers={"kid": "test-kid"})


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch):
    def _fake_fetch(force_refresh=False):
        return {"test-kid": _PUBLIC_KEY}
    monkeypatch.setattr("app.auth._jwks_fetch_keys", _fake_fetch)
    auth._JWKS_CACHE["keys"] = {}
    auth._JWKS_CACHE["fetched_at"] = 0.0
    yield
    auth._JWKS_CACHE["keys"] = {}
    auth._JWKS_CACHE["fetched_at"] = 0.0


@pytest.fixture
def _stub_core(monkeypatch):
    """Replace the handler's downstream httpx.AsyncClient with a MockTransport.

    The handler builds `httpx.AsyncClient()` directly (app.main namespace),
    so patch the module attribute the handler actually resolves.
    """
    original_client = httpx.AsyncClient

    def _install(handler):
        class _Factory:
            def __init__(self, *args, **kwargs):
                self._client = original_client(transport=httpx.MockTransport(handler))

            async def __aenter__(self):
                return self._client

            async def __aexit__(self, *exc):
                await self._client.aclose()

        monkeypatch.setattr("app.main.httpx", httpx)
        monkeypatch.setattr(httpx, "AsyncClient", _Factory)

    return _install


def test_usage_summary_core_200_returns_payload(_stub_core):
    token = _token()
    def handler(request):
        assert request.headers.get("Authorization") == "Bearer " + token
        return httpx.Response(200, json={"accounts": [], "usage_watermark": None})
    _stub_core(handler)
    resp = client.get("/api/usage/summary", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"accounts": [], "usage_watermark": None}


def test_usage_summary_core_404_surfaces_502_json_never_500(_stub_core):
    """The live-caught class: a stale core (read plane absent -> 404) must
    surface the typed degraded 502 JSON so the UI shows its degraded state —
    not an unhandled AttributeError 500 text/plain."""
    def handler(request):
        return httpx.Response(404, text="Not Found")
    _stub_core(handler)
    resp = client.get("/api/usage/summary", headers=_auth(_token()))
    assert resp.status_code == 502, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "usage_summary_unavailable"}


def test_usage_summary_core_401_surfaces_401_json(_stub_core):
    def handler(request):
        return httpx.Response(401, json={"detail": "nope"})
    _stub_core(handler)
    resp = client.get("/api/usage/summary", headers=_auth(_token()))
    assert resp.status_code == 401, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "usage_summary_unauthorized"}


def test_usage_summary_unauthenticated_401_json():
    resp = client.get("/api/usage/summary")
    assert resp.status_code == 401
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "Missing bearer token"}
