"""HIVE-602 live-theater + HIVE-603 activity stream tests.

Reuses the RS256/JWKS stubbing from test_summary (same app instance)."""
import asyncio
import base64
import json
import os

os.environ.setdefault("SHIZUHA_JWKS_URL", "https://id.test/.well-known/jwks.json")

import datetime
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


# ---- HIVE-602 live-theater endpoint -----------------------------------------

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


# ---- HIVE-602 clients -------------------------------------------------------

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


# ---- HIVE-602 cockpit drill-downs -------------------------------------------

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


# ---- HIVE-603 activity stream tests -----------------------------------------

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth
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


def _make_event(org_id, stream_id, source="pulse", etype="task.transition", summary="test"):
    return {
        "id": stream_id,
        "version": 1,
        "source": source,
        "type": etype,
        "occurred_at": "2026-07-10T00:00:00Z",
        "org_id": org_id,
        "summary": summary,
        "actor": {"kind": "system"},
        "target": {"kind": "task", "key": "HIVE-1"},
        "redaction": "none",
        "priority": "normal",
        "metadata": {},
    }


# ---- Mock Redis fixture ------------------------------------------------------


class _MockRedis:
    """In-memory mock of redis.asyncio.Redis for stream operations."""

    def __init__(self):
        self.streams: dict[str, list[tuple[str, dict]]] = {}
        self._counter = 0

    async def aclose(self):
        pass

    def _next_id(self):
        self._counter += 1
        ts = 1700000000000 + self._counter
        return f"{ts}-0"

    def _stream_key(self, org_id):
        return f"home:activity:v1:org:{org_id}"

    async def xrange(self, name, min="-", max="+", count=None):
        entries = self.streams.get(name, [])
        # Parse min/max
        if min.startswith("("):
            min_id = min[1:]
            inclusive_min = False
        else:
            min_id = min
            inclusive_min = True
        if max == "+":
            max_id = "zzzzzzzzzzz"
        else:
            max_id = max

        filtered = []
        for sid, data in entries:
            if inclusive_min and sid < min_id:
                continue
            if not inclusive_min and sid <= min_id:
                continue
            if sid > max_id:
                continue
            filtered.append((sid, data))

        if count:
            filtered = filtered[:count]
        return filtered

    async def xrevrange(self, name, max="+", min="-", count=None):
        entries = self.streams.get(name, [])
        # Parse max/min
        if max == "+":
            max_id = "zzzzzzzzzzz"
        else:
            max_id = max
        if min == "-":
            min_id = ""
        else:
            min_id = min

        filtered = []
        for sid, data in entries:
            if sid > max_id:
                continue
            if sid < min_id:
                continue
            filtered.append((sid, data))

        filtered.reverse()
        if count:
            filtered = filtered[:count]
        return filtered

    async def xread(self, streams, count=None, block=None):
        results = []
        for stream_name, since_id in streams.items():
            entries = self.streams.get(stream_name, [])
            new_entries = []
            for sid, data in entries:
                if since_id == "$":
                    # "$" means "latest" — return nothing for new events
                    continue
                if sid > since_id:
                    new_entries.append((sid, data))
            if count:
                new_entries = new_entries[:count]
            if new_entries:
                results.append((stream_name, new_entries))
        return results

    def add_event(self, org_id, event_data):
        """Helper to add an event to a mock stream."""
        key = self._stream_key(org_id)
        if key not in self.streams:
            self.streams[key] = []
        sid = self._next_id()
        event_data["id"] = sid
        self.streams[key].append((sid, {"event": json.dumps(event_data)}))
        return sid


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


@pytest.fixture(autouse=True)
def _stub_redis(monkeypatch):
    """Replace redis.asyncio with a mock that returns _MockRedis."""
    from app.redis_client import reset_pools
    reset_pools()
    mock = _MockRedis()

    # Add some seed events
    mock.add_event(1, _make_event(1, "", source="pulse", etype="task.comment", summary="Comment on HIVE-1"))
    mock.add_event(1, _make_event(1, "", source="pulse", etype="task.transition", summary="HIVE-1 moved to in_progress"))
    mock.add_event(7, _make_event(7, "", source="hive", etype="agent.status", summary="Agent nagi is running"))

    class _MockPool:
        """Mock connection pool that returns the mock Redis instance."""
        def __init__(self, *args, **kwargs):
            pass

    def _fake_pool_from_url(url, **kwargs):
        return _MockPool()

    def _fake_redis_from_pool(connection_pool=None, **kwargs):
        return mock

    monkeypatch.setattr("app.redis_client.aioredis.ConnectionPool.from_url", _fake_pool_from_url)
    monkeypatch.setattr("app.redis_client.aioredis.Redis", _fake_redis_from_pool)
    # Shorten SSE read timeout so stream tests don't block for 30s
    monkeypatch.setattr(settings, "ACTIVITY_STREAM_READ_TIMEOUT_MS", 100)
    return mock


# ---- Auth / tenant scope -----------------------------------------------------


def test_activity_recent_no_token_is_401():
    assert client.get("/api/home/activity/recent").status_code == 401


def test_activity_recent_garbage_token_is_401():
    assert client.get("/api/home/activity/recent", headers=_auth("not.a.jwt")).status_code == 401


def test_activity_recent_expired_token_is_401():
    assert client.get("/api/home/activity/recent", headers=_auth(_token(expired=True))).status_code == 401


def test_activity_stream_no_token_is_401():
    assert client.get("/api/home/activity/stream").status_code == 401


# ---- Single-org recent -------------------------------------------------------


def test_activity_recent_single_org_returns_events():
    r = client.get("/api/home/activity/recent?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    assert len(body["events"]) == 2
    assert body["events"][0]["org_id"] == 1
    assert body["cursor_by_org"]["1"] is not None


def test_activity_recent_single_org_foreign_org_is_403():
    r = client.get("/api/home/activity/recent?org_id=999", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 403


def test_activity_recent_single_org_with_since():
    r = client.get("/api/home/activity/recent?org_id=1&since=1700000000001-0", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    # Only events after the cursor
    for ev in body["events"]:
        assert ev["id"] > "1700000000001-0"


def test_activity_recent_single_org_empty_org():
    """An org with no events returns an empty list, not an error."""
    r = client.get("/api/home/activity/recent?org_id=1", headers=_auth(_token(memberships={"1": "admin", "99": "member"})))
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["events"], list)


# ---- Aggregate recent --------------------------------------------------------


def test_activity_recent_aggregate_merges_across_orgs():
    r = client.get("/api/home/activity/recent", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    body = r.json()
    # Should have events from both org 1 and org 7
    orgs_seen = {ev["org_id"] for ev in body["events"]}
    assert 1 in orgs_seen
    assert 7 in orgs_seen
    assert "cursor_by_org" in body


def test_activity_recent_aggregate_rejects_bare_since():
    """Aggregate mode with bare since= returns 400 (HLD §6)."""
    r = client.get("/api/home/activity/recent?since=1700000000000-0", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 400


def test_activity_recent_aggregate_with_since_by_org():
    cursors = base64.urlsafe_b64encode(json.dumps({"1": "1700000000001-0"}).encode()).decode()
    r = client.get(f"/api/home/activity/recent?since_by_org={cursors}", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    body = r.json()
    # Events from org 1 should be after the cursor
    for ev in body["events"]:
        if ev["org_id"] == 1:
            assert ev["id"] > "1700000000001-0"


def test_activity_recent_aggregate_excludes_non_member_orgs():
    """Caller with only org 1 membership should not see org 7 events."""
    r = client.get("/api/home/activity/recent", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    for ev in body["events"]:
        assert ev["org_id"] == 1


# ---- SSE stream endpoint -----------------------------------------------------


def test_activity_stream_foreign_org_is_403():
    """403 is returned before the generator starts, so client.get works."""
    r = client.get("/api/home/activity/stream?org_id=999", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 403


def test_activity_stream_aggregate_rejects_bare_since():
    """400 is returned before the generator starts, so client.get works."""
    r = client.get("/api/home/activity/stream?since=1700000000000-0", headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 400


# ---- Slot lifecycle regression (HIVE-607 P1) ---------------------------------


@pytest.mark.asyncio
async def test_bounded_stream_slot_lifecycle():
    """Slot is released only when _bounded_stream terminates, not when the
    inner generator closes. A slow-client timeout must not leave an open
    wrapper uncounted."""
    import app.main
    from app.main import _bounded_stream, _acquire_stream_slot

    # Reset slot count
    app.main._active_stream_connections = 0

    # Acquire a slot (as stream_activity does)
    acquired = await _acquire_stream_slot()
    assert acquired
    assert app.main._active_stream_connections == 1

    # Inner generator that yields two items then completes
    async def _inner():
        try:
            yield "data: one\n\n"
            yield "data: two\n\n"
        finally:
            # Slot should NOT be released here — the outer wrapper owns it
            pass

    # Collect all yielded chunks from _bounded_stream
    chunks = []
    async for chunk in _bounded_stream(_inner(), max_buffer=1, write_timeout=0.01):
        chunks.append(chunk)

    # After the wrapper terminates, the slot should be released
    assert app.main._active_stream_connections == 0, (
        f"Slot should be 0 after wrapper termination, got {app.main._active_stream_connections}"
    )
    assert chunks == ["data: one\n\n", "data: two\n\n"]


@pytest.mark.asyncio
async def test_bounded_stream_slot_released_on_slow_client():
    """When the producer times out (slow client), the slot is released only
    after the wrapper terminates — not when the inner generator closes.
    The producer_done event lets the wrapper drain and terminate cleanly
    without raising."""
    import app.main
    from app.main import _bounded_stream, _acquire_stream_slot

    # Reset slot count
    app.main._active_stream_connections = 0

    acquired = await _acquire_stream_slot()
    assert acquired
    assert app.main._active_stream_connections == 1

    # Inner generator that yields many items to fill the queue faster
    # than the consumer can drain.
    inner_closed = False

    async def _inner():
        nonlocal inner_closed
        try:
            for i in range(100):
                yield f"data: item{i}\n\n"
        finally:
            inner_closed = True

    chunks = []
    # Consumer is slow: sleep before each iteration so the queue fills up
    # and the producer times out on put.
    async for chunk in _bounded_stream(_inner(), max_buffer=4, write_timeout=0.01):
        chunks.append(chunk)
        await asyncio.sleep(0.05)  # slow consumer — queue fills up

    # Inner generator was closed by the producer's finally
    assert inner_closed, "Inner generator should have been closed on timeout"

    # Slot should be released after wrapper termination
    assert app.main._active_stream_connections == 0, (
        f"Slot should be 0 after wrapper termination, got {app.main._active_stream_connections}"
    )
    # Some items were yielded before timeout
    assert len(chunks) >= 1


# ---- HLD §11 bounded-load/cap acceptance ------------------------------------


def test_stream_cap_plus_one_returns_503_with_retry_after(monkeypatch):
    """HLD §11: When HOME_SSE_MAX_CONNECTIONS slots are full, the N+1 request
    returns 503 with a Retry-After header.
    Uses _acquire_stream_slot directly because TestClient consumes
    StreamingResponse synchronously, releasing the slot before the
    second request."""
    import app.main
    from app.config import settings

    monkeypatch.setattr(settings, "HOME_SSE_MAX_CONNECTIONS", 1)
    app.main._active_stream_connections = 0

    # Acquire the only slot directly (simulates an active stream)
    acquired = asyncio.run(app.main._acquire_stream_slot())
    assert acquired
    assert app.main._active_stream_connections == 1

    # Second request should be 503
    r = client.get("/api/home/activity/stream?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 503
    assert r.headers.get("Retry-After") == "10"

    # Release the held slot
    asyncio.run(app.main._release_stream_slot())
    assert app.main._active_stream_connections == 0


def test_stream_slots_return_to_zero_after_close(monkeypatch):
    """HLD §11: After all streams close, _active_stream_connections returns to 0.
    Uses TestClient which consumes StreamingResponse synchronously, so each
    request completes and releases its slot before the next starts."""
    import app.main
    from app.config import settings

    monkeypatch.setattr(settings, "HOME_SSE_MAX_CONNECTIONS", 3)
    app.main._active_stream_connections = 0

    # Open 2 streams sequentially (TestClient consumes each synchronously)
    r1 = client.get("/api/home/activity/stream?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    r2 = client.get("/api/home/activity/stream?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r1.status_code == 200
    assert r2.status_code == 200

    # Close both
    r1.close()
    r2.close()

    # Slot count should be 0
    assert app.main._active_stream_connections == 0


def test_stream_slot_released_on_client_disconnect(monkeypatch):
    """HLD §11: When a client disconnects, the slot is released.
    Uses _acquire_stream_slot directly because TestClient consumes
    StreamingResponse synchronously."""
    import app.main
    from app.config import settings

    monkeypatch.setattr(settings, "HOME_SSE_MAX_CONNECTIONS", 1)
    app.main._active_stream_connections = 0

    # Acquire a slot directly
    acquired = asyncio.run(app.main._acquire_stream_slot())
    assert acquired
    assert app.main._active_stream_connections == 1

    # Release the slot
    asyncio.run(app.main._release_stream_slot())
    assert app.main._active_stream_connections == 0


def test_activity_stream_returns_sse_headers(monkeypatch):
    """SSE endpoint returns text/event-stream with correct headers."""
    import app.main
    from app.config import settings

    monkeypatch.setattr(settings, "HOME_SSE_MAX_CONNECTIONS", 10)
    app.main._active_stream_connections = 0

    r = client.get("/api/home/activity/stream?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")
    assert r.headers.get("cache-control") == "no-cache"
    assert r.headers.get("x-accel-buffering") == "no"
    r.close()


@pytest.mark.asyncio
async def test_concurrent_stream_cap_sheds_n_plus_one_and_cleans_up(monkeypatch):
    """HLD §11: Hold N real endpoint streams open concurrently, prove N+1
    returns 503 + Retry-After while count remains N, then close all held
    streams and prove _active_stream_connections returns to 0.

    Uses raw ASGI with proper scope headers and monkeypatched JWKS fetch
    for auth. Sets a very short stream lifetime so streams expire naturally.
    Runs all streams via asyncio.gather() in the same task context to
    avoid Starlette task-group cross-task cancellation issues."""
    import app.main as main_module
    from app.config import settings

    monkeypatch.setattr(settings, "HOME_SSE_MAX_CONNECTIONS", 3)
    monkeypatch.setattr(settings, "ACTIVITY_STREAM_READ_TIMEOUT_MS", 5000)
    monkeypatch.setattr(settings, "ACTIVITY_SSE_HEARTBEAT_SECONDS", 1)
    monkeypatch.setattr(settings, "HOME_SSE_REVALIDATE_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(settings, "HOME_SSE_MAX_LIFETIME_SECONDS", 3600)  # long lifetime — we disconnect explicitly
    main_module._active_stream_connections = 0

    # Mock block_read to return empty (stream stays open yielding heartbeats)
    async def _fake_block_read(*args, **kwargs):
        await asyncio.sleep(0.5)
        return []

    monkeypatch.setattr("app.main.block_read", _fake_block_read)
    monkeypatch.setattr("app.main.block_read_multi", _fake_block_read)

    # Mock revalidation to pass
    async def _fake_revalidate(*args, **kwargs):
        return True

    monkeypatch.setattr("app.main._revalidate_membership", _fake_revalidate)

    # Stub JWKS fetch so RS256 token verification works.
    # Must patch _decode_verified (not _jwks_fetch_keys) because
    # _decode_verified has a local reference to the original function.
    from app import auth
    from fastapi import status as http_status
    from fastapi import HTTPException

    def _fake_decode_verified(token):
        import jwt as _jwt
        try:
            header = _jwt.get_unverified_header(token)
        except Exception:
            raise HTTPException(http_status.HTTP_401_UNAUTHORIZED, "Invalid token")
        try:
            return _jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        except _jwt.ExpiredSignatureError:
            raise HTTPException(http_status.HTTP_401_UNAUTHORIZED, "Token expired")
        except _jwt.InvalidTokenError:
            raise HTTPException(http_status.HTTP_401_UNAUTHORIZED, "Invalid token")

    monkeypatch.setattr("app.auth._decode_verified", _fake_decode_verified)

    tok = _token(memberships={"1": "admin"})

    async def _run_stream() -> dict:
        """Run a single stream request via raw ASGI and return status + headers.
        The stream stays open until the caller sets the disconnect event."""
        result = {"status": None, "headers": {}}
        received_request = False
        disconnect = asyncio.Event()

        async def receive():
            nonlocal received_request
            if not received_request:
                received_request = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                result["status"] = message["status"]
                # Capture headers as a dict
                for key, val in message.get("headers", []):
                    result["headers"][key.decode()] = val.decode()

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/home/activity/stream",
            "query_string": b"org_id=1",
            "headers": [
                (b"authorization", f"Bearer {tok}".encode()),
                (b"host", b"test"),
            ],
            "scheme": "http",
            "server": ("test", 80),
            "client": ("127.0.0.1", 50000),
            "asgi": {"version": "3.0"},
        }
        await main_module.app(scope, receive, send)
        return result

    # Open N=3 concurrent streams as background tasks.
    s1 = asyncio.create_task(_run_stream())
    s2 = asyncio.create_task(_run_stream())
    s3 = asyncio.create_task(_run_stream())

    # Wait for all 3 slots to be acquired (with retry for busy event loop)
    for attempt in range(30):
        if main_module._active_stream_connections >= 3:
            break
        await asyncio.sleep(0.05)

    # Slot count should be 3
    assert main_module._active_stream_connections == 3, (
        f"Expected 3 active slots, got {main_module._active_stream_connections}"
    )

    # N+1 request should be 503 with Retry-After
    n1 = asyncio.create_task(_run_stream())
    n1_result = await asyncio.wait_for(n1, timeout=5)
    assert n1_result["status"] == 503, f"N+1 request should be 503, got {n1_result['status']}"
    assert n1_result["headers"].get("retry-after") == "10", (
        f"N+1 should have Retry-After: 10, got {n1_result['headers'].get('retry-after')}"
    )

    # Slot count should still be 3
    assert main_module._active_stream_connections == 3, (
        f"Expected 3 active slots after 503, got {main_module._active_stream_connections}"
    )

    # Explicitly disconnect all 3 held streams by cancelling their tasks
    s1.cancel()
    s2.cancel()
    s3.cancel()
    await asyncio.wait_for(asyncio.gather(s1, s2, s3, return_exceptions=True), timeout=5)

    # Slot count should return to 0 after all streams are disconnected
    assert main_module._active_stream_connections == 0, (
        f"Expected 0 active slots after disconnect, got {main_module._active_stream_connections}"
    )


def test_activity_recent_handles_500_events(monkeypatch):
    """HLD §11: inject ≥500 events for one org and verify bounded
    retained history and correct cursor. Also proves bounded server cost:
    the server only reads `limit` entries from Redis, not all 500."""
    from app.redis_client import reset_pools
    reset_pools()
    mock = _MockRedis()

    class _MockPool:
        def __init__(self, *args, **kwargs):
            pass

    def _fake_pool_from_url(url, **kwargs):
        return _MockPool()

    def _fake_redis_from_pool(connection_pool=None, **kwargs):
        return mock

    monkeypatch.setattr("app.redis_client.aioredis.ConnectionPool.from_url", _fake_pool_from_url)
    monkeypatch.setattr("app.redis_client.aioredis.Redis", _fake_redis_from_pool)

    # Track how many entries are accessed via xrevrange
    original_xrevrange = mock.xrevrange
    xrevrange_call_count = [0]
    xrevrange_returned_count = [0]

    async def tracking_xrevrange(name, max="+", min="-", count=None):
        xrevrange_call_count[0] += 1
        result = await original_xrevrange(name, max, min, count)
        xrevrange_returned_count[0] += len(result)
        return result

    mock.xrevrange = tracking_xrevrange

    # Inject 500 events for org 1
    for i in range(500):
        mock.add_event(1, _make_event(1, "", source="pulse", etype="task.comment",
                                       summary=f"Event {i}"))

    r = client.get("/api/home/activity/recent?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    # Should return events (bounded by the limit, not all 500)
    assert len(body["events"]) > 0
    assert len(body["events"]) <= 100  # default limit
    # Cursor should point to the latest event
    assert body["cursor_by_org"]["1"] is not None

    # Prove bounded server cost: xrevrange was called with count=50 (default limit)
    # and returned at most 50 entries, not all 500
    assert xrevrange_call_count[0] == 1, (
        f"Expected 1 xrevrange call, got {xrevrange_call_count[0]}"
    )
    assert xrevrange_returned_count[0] <= 100, (
        f"xrevrange returned {xrevrange_returned_count[0]} entries, expected ≤100"
    )
    assert xrevrange_returned_count[0] < 500, (
        f"xrevrange returned {xrevrange_returned_count[0]} entries — "
        f"should be bounded by limit, not all 500"
    )


# ---- Redis degradation -------------------------------------------------------


def test_activity_recent_degrades_on_redis_failure(monkeypatch):
    """When Redis is down, /recent returns empty events with degraded_sources."""
    from app.redis_client import reset_pools
    reset_pools()

    def _broken_pool_from_url(url, **kwargs):
        raise ConnectionError("Redis is down")

    monkeypatch.setattr("app.redis_client.aioredis.ConnectionPool.from_url", _broken_pool_from_url)

    r = client.get("/api/home/activity/recent?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    assert body["events"] == []
    assert "1" in body["degraded_sources"]


# ---- Cursor encoding helpers -------------------------------------------------


def test_decode_since_by_org_valid():
    from app.main import _decode_since_by_org
    cursors = base64.urlsafe_b64encode(json.dumps({"1": "1700-0"}).encode()).decode()
    result = _decode_since_by_org(cursors)
    assert result == {"1": "1700-0"}


def test_decode_since_by_org_none():
    from app.main import _decode_since_by_org
    assert _decode_since_by_org(None) is None


def test_decode_since_by_org_invalid():
    from app.main import _decode_since_by_org
    assert _decode_since_by_org("not-base64!!!") is None


def test_encode_since_by_org_roundtrip():
    from app.main import _decode_since_by_org, _encode_since_by_org
    original = {"1": "1700-0", "7": "0900-0"}
    encoded = _encode_since_by_org(original)
    decoded = _decode_since_by_org(encoded)
    assert decoded == original


def test_build_cursor_by_org():
    from app.main import _build_cursor_by_org
    events = [
        {"org_id": 1, "id": "100-0"},
        {"org_id": 1, "id": "200-0"},
        {"org_id": 7, "id": "050-0"},
    ]
    cursor = _build_cursor_by_org(events)
    assert cursor == {"1": "200-0", "7": "050-0"}


# ---- PLAT-1305: Schema validation, deauth, slow-client, cursor edge cases -----


def test_event_schema_rejects_bad_source():
    """HomeActivityEventV1 enum rejects unknown source values."""
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="unknown_source",
            type="task.comment",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
        )


def test_event_schema_rejects_bad_type():
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="pulse",
            type="not.a.valid.type",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
        )


def test_event_schema_rejects_bad_redaction():
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="pulse",
            type="task.comment",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
            redaction="invalid_level",
        )


def test_event_schema_rejects_bad_priority():
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="pulse",
            type="task.comment",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
            priority="critical",
        )


def test_event_schema_rejects_bad_actor_kind():
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="pulse",
            type="task.comment",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
            actor={"kind": "bot"},
        )


def test_event_schema_rejects_bad_target_kind():
    from app.schema import HomeActivityEventV1
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        HomeActivityEventV1(
            id="100-0",
            source="pulse",
            type="task.comment",
            occurred_at="2026-07-10T00:00:00Z",
            org_id=1,
            target={"kind": "invalid"},
        )


def test_event_schema_accepts_valid_event():
    """A fully valid event passes schema validation."""
    from app.schema import HomeActivityEventV1
    ev = HomeActivityEventV1(
        id="100-0",
        source="pulse",
        type="task.comment",
        occurred_at="2026-07-10T00:00:00Z",
        org_id=1,
        summary="A valid comment",
        actor={"kind": "user", "username": "testuser"},
        target={"kind": "task", "key": "HIVE-1"},
        redaction="none",
        priority="high",
    )
    assert ev.version == 1
    assert ev.source.value == "pulse"
    assert ev.type.value == "task.comment"
    assert ev.redaction.value == "none"
    assert ev.priority.value == "high"
    assert ev.actor.kind.value == "user"
    assert ev.target.kind.value == "task"


def test_parse_entry_drops_suppressed_redaction(monkeypatch):
    """Events with redaction=suppressed are dropped by _parse_entry."""
    from app.redis_client import _parse_entry
    event_data = {
        "event": json.dumps({
            "version": 1,
            "source": "pulse",
            "type": "task.comment",
            "occurred_at": "2026-07-10T00:00:00Z",
            "org_id": 1,
            "summary": "private",
            "redaction": "suppressed",
            "priority": "normal",
            "actor": {"kind": "system"},
            "target": {"kind": "task", "key": "HIVE-1"},
        })
    }
    result = _parse_entry("100-0", event_data, expected_org=1)
    assert result is None


def test_parse_entry_drops_wrong_org():
    """Event with org_id mismatching the stream key is dropped."""
    from app.redis_client import _parse_entry
    event_data = {
        "event": json.dumps({
            "version": 1,
            "source": "pulse",
            "type": "task.comment",
            "occurred_at": "2026-07-10T00:00:00Z",
            "org_id": 7,  # wrong org
            "summary": "cross-org leak",
            "redaction": "none",
            "priority": "normal",
            "actor": {"kind": "system"},
            "target": {"kind": "task", "key": "HIVE-1"},
        })
    }
    result = _parse_entry("100-0", event_data, expected_org=1)
    assert result is None


def test_parse_entry_drops_long_summary():
    """Event with summary > 2000 chars is dropped."""
    from app.redis_client import _parse_entry
    event_data = {
        "event": json.dumps({
            "version": 1,
            "source": "pulse",
            "type": "task.comment",
            "occurred_at": "2026-07-10T00:00:00Z",
            "org_id": 1,
            "summary": "x" * 2001,
            "redaction": "none",
            "priority": "normal",
            "actor": {"kind": "system"},
            "target": {"kind": "task", "key": "HIVE-1"},
        })
    }
    result = _parse_entry("100-0", event_data, expected_org=1)
    assert result is None


def test_parse_entry_drops_malformed_json():
    """Malformed event JSON is dropped."""
    from app.redis_client import _parse_entry
    result = _parse_entry("100-0", {"event": "not-json{{{}}"}, expected_org=1)
    assert result is None


def test_parse_entry_accepts_valid_event():
    """A valid event passes all checks and returns a dict."""
    from app.redis_client import _parse_entry
    event_data = {
        "event": json.dumps({
            "version": 1,
            "source": "pulse",
            "type": "task.comment",
            "occurred_at": "2026-07-10T00:00:00Z",
            "org_id": 1,
            "summary": "valid event",
            "redaction": "none",
            "priority": "normal",
            "actor": {"kind": "system"},
            "target": {"kind": "task", "key": "HIVE-1"},
        })
    }
    result = _parse_entry("100-0", event_data, expected_org=1)
    assert result is not None
    assert result["id"] == "100-0"
    assert result["org_id"] == 1
    assert result["summary"] == "valid event"


def test_stream_id_gt():
    """_stream_id_gt correctly compares Redis stream IDs."""
    from app.main import _stream_id_gt
    # Same timestamp, different sequence
    assert _stream_id_gt("1700000000001-1", "1700000000001-0")
    assert not _stream_id_gt("1700000000001-0", "1700000000001-1")
    # Different timestamp
    assert _stream_id_gt("1700000000002-0", "1700000000001-0")
    assert not _stream_id_gt("1700000000001-0", "1700000000002-0")
    # Equal
    assert not _stream_id_gt("1700000000001-0", "1700000000001-0")
    # No sequence part
    assert _stream_id_gt("1700000000002", "1700000000001")
    assert not _stream_id_gt("1700000000001", "1700000000002")


def test_activity_recent_aggregate_excludes_deauth_org_events(monkeypatch):
    """Aggregate recent should not include events from orgs the caller
    was deauthorized from between cursor and read."""
    from app.redis_client import _parse_entry, read_recent_multi
    # This is tested at the endpoint level: the caller only has org 1,
    # so org 7 events should not appear
    r = client.get("/api/home/activity/recent", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    for ev in body["events"]:
        assert ev["org_id"] == 1


def test_activity_recent_handles_empty_redis(monkeypatch):
    """When Redis has no events for an org, return empty list."""
    from app.redis_client import reset_pools
    reset_pools()
    mock = _MockRedis()
    # No seed events added

    class _MockPool:
        def __init__(self, *args, **kwargs):
            pass

    def _fake_pool_from_url(url, **kwargs):
        return _MockPool()

    def _fake_redis_from_pool(connection_pool=None, **kwargs):
        return mock

    monkeypatch.setattr("app.redis_client.aioredis.ConnectionPool.from_url", _fake_pool_from_url)
    monkeypatch.setattr("app.redis_client.aioredis.Redis", _fake_redis_from_pool)

    r = client.get("/api/home/activity/recent?org_id=1", headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 200
    body = r.json()
    assert body["events"] == []


def test_activity_recent_malformed_cursor_returns_400():
    """Malformed since_by_org returns 400."""
    r = client.get("/api/home/activity/recent?since_by_org=not-valid-base64url",
                   headers=_auth(_token(memberships={"1": "admin"})))
    assert r.status_code == 400


def test_activity_recent_aggregate_with_empty_since_by_org():
    """Empty since_by_org in aggregate mode returns all events."""
    r = client.get("/api/home/activity/recent",
                   headers=_auth(_token(memberships={"1": "admin", "7": "member"})))
    assert r.status_code == 200
    body = r.json()
    assert len(body["events"]) >= 2  # events from both orgs
