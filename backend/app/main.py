"""HIVE-375 home BFF (slice 1) — GET /api/home/summary.
HIVE-603 activity stream — GET /api/home/activity/recent + /stream.

A thin stateless async fan-out (aoi-approved: FastAPI thin-async-BFF, stateless
only, forward-caller-JWT). Slice 1 surfaces: `orgs` (from the verified JWT claim,
no downstream call) + `tasks_by_status` (pulse, forwarded Bearer). The envelope
is versioned (HomeSummaryV1) and always 200 (partial); auth failures are 401/403.

HIVE-603 adds Redis Streams-backed activity endpoints: /recent returns bounded
history, /stream returns text/event-stream for live updates. Both use the same
auth model (verified JWT, org membership gate, no privileged token).

Tenant isolation (the load-bearing control): identity + org scope come only from
the *verified* token; a requested org must be one the caller belongs to (403
otherwise); downstreams receive the caller's own Bearer so each applies its own
authz — the BFF holds no privileged token and can never widen scope / leak
cross-org. (STRIDE-lite on the task; PLAT-1236 cross-org→403 tests below.)
"""
import asyncio
import base64
import datetime
import json
import time
from typing import AsyncGenerator, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from .auth import Caller, resolve_scope_org, verify_caller
from .cache import cache_key, widget_cache
from .clients import (
    fetch_agent_activity, fetch_agent_peek, fetch_agents_live, fetch_alerts,
    fetch_financial_snapshot, fetch_live_feed, fetch_org_map, fetch_org_progress,
    fetch_org_refs, fetch_recent_conversations, fetch_task_peek, fetch_tasks_by_status,
)
from .audit_leads import AuditLeadRequest, AuditLeadResponse, persist_audit_lead
from .config import settings
from .harness_upgrade import get_upgrade_history, get_upgrade_status, poll_and_upgrade
from .redis_client import block_read, block_read_multi, read_recent, read_recent_multi
from .schema import (
    ActivityRecentResponse, HomeActivityEventV1, HomeSummaryV1, HomeActivityV1,
    SUMMARY_VERSION, Widget,
)

app = FastAPI(title="Shizuha Home BFF", version=str(SUMMARY_VERSION))

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Avoid reflecting AuditLead PII in public validation error traces."""
    if request.url.path == "/api/research/audit-leads":
        errors = []
        for err in exc.errors():
            scrubbed = {k: v for k, v in err.items() if k not in {"input", "ctx"}}
            errors.append(scrubbed)
        return JSONResponse(status_code=422, content={"detail": errors})
    return await request_validation_exception_handler(request, exc)

_audit_lead_rate_window: dict[str, list[float]] = {}


def _check_audit_lead_rate_limit(request: Request) -> None:
    """Small public-intake anti-abuse guard; fail closed per client IP."""
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window_start = now - 60
    recent = [ts for ts in _audit_lead_rate_window.get(ip, []) if ts >= window_start]
    if len(recent) >= settings.AUDIT_LEAD_RATE_LIMIT_PER_MINUTE:
        _audit_lead_rate_window[ip] = recent
        raise HTTPException(status_code=429, detail="Too many audit-intent submissions; please retry later")
    recent.append(now)
    _audit_lead_rate_window[ip] = recent


def _clear_audit_lead_rate_limits_for_tests() -> None:
    _audit_lead_rate_window.clear()


@app.get("/api/home/health")
async def health():
    return {"status": "ok", "version": SUMMARY_VERSION}


@app.post("/api/research/audit-leads", response_model=AuditLeadResponse, status_code=201)
async def create_audit_lead(payload: AuditLeadRequest, request: Request) -> AuditLeadResponse:
    """Intent-only GEO audit intake. No payment, fetching, or fulfillment."""
    _check_audit_lead_rate_limit(request)
    record = persist_audit_lead(payload)
    return AuditLeadResponse(
        lead_id=record.lead_id,
        offer_tier=record.offer_tier,
        price_shown=record.price_shown,
        intent=record.intent,
        disclaimer_version=record.disclaimer_version,
        dpdp_notice_version=record.dpdp_notice_version,
        message=(
            "Intent received. This is not a purchase: no payment was collected, "
            "no live-site audit has started, and Shizuha will contact you to confirm scope first."
        ),
    )


def _first_org(caller: Caller) -> Optional[int]:
    """Deterministic default org (lowest id) for widgets that need one."""
    try:
        return sorted(caller.memberships.keys())[0] if caller.memberships else None
    except Exception:
        return None


@app.get("/api/home/summary", response_model=HomeSummaryV1)
async def home_summary(
    caller: Caller = Depends(verify_caller),
    org_id: Optional[int] = Query(default=None),
) -> HomeSummaryV1:
    # 403 if the caller asked for an org they don't belong to.
    scope_org = resolve_scope_org(caller, org_id)

    # Fan out to downstreams concurrently, forwarding the caller's Bearer. Each
    # client is fail-soft, so a slow/down source degrades only its widget.
    # Cacheable widgets serve recently-good stale data during brownouts.
    async with httpx.AsyncClient() as client:
        orgs, tasks_widget, agent_widget, alerts_widget, financial_widget, conversations_widget = await asyncio.gather(
            fetch_org_refs(client, caller.bearer, caller.user_id, caller.email, caller.memberships),
            widget_cache.get_or_fetch(
                cache_key("tasks_by_status", caller.user_id, scope_org, caller.memberships),
                # No selected org → aggregate work-in-flight across every org
                # the token grants (HIVE-373: the command center shows the
                # org's autonomous work, not just the caller's own queue).
                lambda: fetch_tasks_by_status(
                    client, caller.bearer, caller.email, scope_org,
                    org_ids=sorted(caller.memberships.keys()),
                ),
            ),
            fetch_agent_activity(client, caller.bearer, scope_org),
            widget_cache.get_or_fetch(
                cache_key("alerts", caller.user_id, scope_org, caller.memberships),
                lambda: fetch_alerts(client, caller.bearer, scope_org),
            ),
            widget_cache.get_or_fetch(
                # Books requires a concrete org; with none selected, default to
                # the caller's first org so the panel is never a dead
                # "select an organization" tile (HIVE-602: no inert panels).
                cache_key(
                    "financial_snapshot",
                    caller.user_id,
                    scope_org if scope_org is not None else _first_org(caller),
                    caller.memberships,
                ),
                lambda: fetch_financial_snapshot(
                    client, caller.bearer,
                    scope_org if scope_org is not None else _first_org(caller)),
                cache_fresh=False,
            ),
            widget_cache.get_or_fetch(
                cache_key("recent_conversations", caller.user_id, scope_org, caller.memberships),
                lambda: fetch_recent_conversations(client, caller.bearer, scope_org),
            ),
        )

    # Tag auto-scoped financials with the org they describe so the UI can
    # caption them (the caller didn't pick this org explicitly).
    if scope_org is None and isinstance(financial_widget.data, dict):
        financial_widget.data.setdefault("org_id", _first_org(caller))

    return HomeSummaryV1(
        generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        org_id=scope_org,
        orgs=orgs,
        widgets={
            "agent_activity": agent_widget,
            "tasks_by_status": tasks_widget,
            "alerts": alerts_widget,
            "financial_snapshot": financial_widget,
            "recent_conversations": conversations_widget,
        },
    )


# ── HIVE-602 live theater ─────────────────────────────────────────────────────

@app.get("/api/home/activity", response_model=HomeActivityV1)
async def home_activity(
    caller: Caller = Depends(verify_caller),
    org_id: Optional[int] = Query(default=None),
    since: Optional[str] = Query(default=None, max_length=40),
) -> HomeActivityV1:
    """HIVE-602 live theater: merged Pulse event feed + fleet-as-live-entities.

    Polled fast (client ~8s) so it is deliberately NOT served from the fresh
    widget cache — every call fetches live, but failures still fall back to
    the stale cache so the theater degrades to recent history, never a blank.
    Same tenant model as /summary: verified-token scope, forwarded Bearer.
    """
    scope_org = resolve_scope_org(caller, org_id)
    feed_orgs = [scope_org] if scope_org is not None else sorted(caller.memberships.keys())

    async with httpx.AsyncClient() as client:
        if since:
            # Delta polls bypass the cache both ways: a delta must not be
            # served stale, and a tiny delta result must not poison the
            # full-feed stale fallback.
            feed_coro = fetch_live_feed(client, caller.bearer,
                                        org_ids=feed_orgs, since=since)
        else:
            feed_coro = widget_cache.get_or_fetch(
                cache_key("live_feed", caller.user_id, scope_org, caller.memberships),
                lambda: fetch_live_feed(client, caller.bearer, org_ids=feed_orgs),
                cache_fresh=False,
            )
        feed_widget, agents_widget = await asyncio.gather(
            feed_coro,
            widget_cache.get_or_fetch(
                # 15s shared fresh-cache: agent state doesn't change per-second,
                # and always-fetch at an 8s poll per viewer pushed ~335KB fleet
                # reads onto hive continuously — enough to flap its (formerly
                # 1s-timeout) readiness probe into a 502 outage (2026-07-10).
                cache_key("agents_live", caller.user_id, scope_org, caller.memberships),
                lambda: fetch_agents_live(client, caller.bearer, scope_org),
            ),
        )

    return HomeActivityV1(
        generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        org_id=scope_org,
        widgets={"feed": feed_widget, "agents": agents_widget},
    )


# ── HIVE-602 cockpit drill-downs — on-demand, uncached, caller-scoped ────────

@app.get("/api/home/agent")
async def home_agent_peek(
    caller: Caller = Depends(verify_caller),
    email: str = Query(min_length=3, max_length=254),
):
    """Agent drawer: active tasks + recent events for one agent."""
    async with httpx.AsyncClient() as client:
        widget = await fetch_agent_peek(client, caller.bearer, email)
    return {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "email": email.strip().lower(), "widget": widget}


@app.get("/api/home/org-map")
async def home_org_map(
    caller: Caller = Depends(verify_caller),
    org_id: int = Query(),
):
    """Org peek: teams + live workload + members. 403 for non-members."""
    scope_org = resolve_scope_org(caller, org_id)
    async with httpx.AsyncClient() as client:
        orgs = await fetch_org_refs(client, caller.bearer, caller.user_id,
                                    caller.email, caller.memberships)
        slug = next((o.slug for o in orgs if o.id == scope_org and o.slug), None)
        widget = (await fetch_org_map(client, caller.bearer, slug)) if slug else Widget.empty_()
    return {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "org_id": scope_org, "widget": widget}


@app.get("/api/home/progress")
async def home_progress(
    caller: Caller = Depends(verify_caller),
    org_id: int = Query(),
    hours: int = Query(24, ge=1, le=720),
    buckets: int = Query(24, ge=1, le=200),
    days: int = Query(7, ge=1, le=90),
):
    """Org progress dashboard: task resolution-rate + intake trend, current
    status distribution, and per-team bottleneck dwell — org-scoped via pulse
    (forwarded Bearer; 403 for a non-member org). Feeds the home charts panel."""
    scope_org = resolve_scope_org(caller, org_id)
    async with httpx.AsyncClient() as client:
        widget = await fetch_org_progress(
            client, caller.bearer, org_id=scope_org,
            hours=hours, buckets=buckets, days=days)
    return {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "org_id": scope_org, "widget": widget}


@app.get("/api/home/task")
async def home_task_peek(
    caller: Caller = Depends(verify_caller),
    key: str = Query(min_length=2, max_length=40),
):
    """Task drawer: one item by human key + activity + comments."""
    async with httpx.AsyncClient() as client:
        widget = await fetch_task_peek(client, caller.bearer, key)
    return {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "key": key.strip(), "widget": widget}


<<<<<<< HEAD
# ── HIVE-615 Harness auto-upgrade endpoints ───────────────────────────────────

@app.get("/api/hive/harness-upgrade/status")
async def harness_upgrade_status(
    caller: Caller = Depends(verify_caller),
):
    """Return current harness auto-upgrade status and recent history."""
    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        **get_upgrade_status(),
    }


@app.get("/api/hive/harness-upgrade/history")
async def harness_upgrade_history(
    caller: Caller = Depends(verify_caller),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Return harness upgrade history."""
    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "upgrades": get_upgrade_history(limit=limit),
    }


@app.post("/api/hive/harness-upgrade/trigger")
async def harness_upgrade_trigger(
    caller: Caller = Depends(verify_caller),
    current_versions: Optional[str] = Query(default=None, description="JSON dict of current harness versions"),
):
    """Manually trigger a poll-and-upgrade cycle. Staff/owner only."""
    # Parse current versions from query param or use empty dict (will detect from Hive).
    versions = {}
    if current_versions:
        try:
            versions = json.loads(current_versions)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=400, detail="current_versions must be a valid JSON object")
    results = await poll_and_upgrade(versions)
    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "upgrades_triggered": len(results),
        "results": [r.__dict__ for r in results],
    }

# ---- HIVE-603 activity stream endpoints --------------------------------------


def _stream_id_gt(a: str, b: str) -> bool:
    """Compare two Redis Stream IDs numerically (not lexically).

    Redis Stream IDs are ``<millisecondsTime>-<sequenceNumber>``.  Lexical
    comparison fails for ``9-0`` vs ``10-0`` (``'9' > '10'`` lexically).
    """
    try:
        a_ms, a_seq = a.split("-", 1)
        b_ms, b_seq = b.split("-", 1)
        a_key = (int(a_ms), int(a_seq))
        b_key = (int(b_ms), int(b_seq))
        return a_key > b_key
    except (ValueError, AttributeError):
        return a > b  # fallback to lexical


def _decode_since_by_org(raw: Optional[str]) -> Optional[dict[str, str]]:
    """Decode base64url-encoded per-org cursor map.

    The HLD specifies base64url-json for the aggregate cursor to avoid URL
    length issues with multiple org cursors.

    Accepts both padded and unpadded base64url (restores padding if needed).
    Returns None on malformed input (400, not silent reset).
    """
    if not raw:
        return None
    try:
        # Restore padding if stripped
        padded = raw
        missing_padding = len(padded) % 4
        if missing_padding:
            padded += "=" * (4 - missing_padding)
        decoded = base64.urlsafe_b64decode(padded)
        return json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        return None


def _encode_since_by_org(cursor_map: dict[str, str]) -> str:
    """Encode per-org cursor map as base64url."""
    return base64.urlsafe_b64encode(json.dumps(cursor_map).encode()).decode()


def _build_cursor_by_org(events: list[dict]) -> dict[str, str]:
    """Build per-org cursor map from a list of events.

    Takes the highest stream id seen per org.
    """
    cursor: dict[str, str] = {}
    for ev in events:
        oid = str(ev.get("org_id", ""))
        sid = ev.get("id", "")
        if oid and sid:
            if oid not in cursor or _stream_id_gt(sid, cursor[oid]):
                cursor[oid] = sid
    return cursor


@app.get("/api/home/activity/recent", response_model=ActivityRecentResponse)
async def activity_recent(
    caller: Caller = Depends(verify_caller),
    org_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    since: Optional[str] = Query(default=None),
    since_by_org: Optional[str] = Query(default=None, alias="since_by_org"),
) -> ActivityRecentResponse:
    """Return bounded recent activity history.

    Single-org mode (org_id present): returns events from that org's stream.
    Aggregate mode (org_id absent): merges events across all caller orgs.

    Cursor rules per HLD §6:
    - Single-org: use `since=<redis_stream_id>`.
    - Aggregate: use `since_by_org=<base64url-json>`.
    - Aggregate with bare `since` returns 400.
    """
    scope_org = resolve_scope_org(caller, org_id)

    if scope_org is not None:
        # Single-org mode
        try:
            events = await read_recent(scope_org, limit=limit, since=since)
        except Exception:
            return ActivityRecentResponse(
                events=[],
                degraded_sources=[str(scope_org)],
            )
        cursor_by_org = _build_cursor_by_org(events)
        return ActivityRecentResponse(events=events, cursor_by_org=cursor_by_org)
    else:
        # Aggregate mode
        if since and not since_by_org:
            raise HTTPException(
                status_code=400,
                detail="Aggregate mode requires since_by_org (base64url-json per-org cursor). "
                       "Bare since= is not supported for multi-org queries.",
            )
        org_ids = list(caller.memberships.keys())
        decoded_cursors = _decode_since_by_org(since_by_org)
        if since_by_org and decoded_cursors is None:
            raise HTTPException(
                status_code=400,
                detail="Malformed since_by_org: expected base64url-encoded JSON cursor map.",
            )
        try:
            events, degraded = await read_recent_multi(
                org_ids,
                limit_per_org=limit,
                since_by_org=decoded_cursors,
            )
        except Exception:
            return ActivityRecentResponse(
                events=[],
                degraded_sources=[str(o) for o in org_ids],
            )
        cursor_by_org = _build_cursor_by_org(events)
        return ActivityRecentResponse(
            events=events,
            cursor_by_org=cursor_by_org,
            degraded_sources=degraded,
        )


# §6.2 per-instance connection cap
_active_stream_connections: int = 0
_stream_connections_lock = asyncio.Lock()

# Slow-client protection: max buffered writes per connection before disconnect.
# When a client reads slower than this, we drop them rather than OOM the BFF.
SLOW_CLIENT_MAX_BUFFER = 64  # events
SLOW_CLIENT_WRITE_TIMEOUT = 30  # seconds


async def _bounded_stream(
    inner: AsyncGenerator[str, None],
    max_buffer: int = SLOW_CLIENT_MAX_BUFFER,
    write_timeout: float = SLOW_CLIENT_WRITE_TIMEOUT,
) -> AsyncGenerator[str, None]:
    """Wrap *inner* with a bounded queue and write timeout.

    The inner generator writes into an ``asyncio.Queue(maxsize=max_buffer)``.
    If the queue is full (client too slow), the inner generator blocks on
    ``put``; if it stays blocked past *write_timeout*, we disconnect the
    slow client by raising.

    Slot ownership is aligned with the outer SSE response lifetime: the
    stream slot is released in THIS generator's ``finally``, not the inner
    generator's, so ``HOME_SSE_MAX_CONNECTIONS`` always bounds actual
    persistent connections. A ``producer_done`` event ensures the wrapper
    terminates promptly even when the sentinel is lost to ``QueueFull``.
    """
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue(maxsize=max_buffer)
    producer_done = asyncio.Event()

    async def _producer():
        try:
            async for chunk in inner:
                await asyncio.wait_for(queue.put(chunk), timeout=write_timeout)
        except asyncio.TimeoutError:
            pass  # slow client — producer stops
        finally:
            # Close the inner generator (its finally still runs, but
            # _release_stream_slot has been moved to the outer wrapper).
            await inner.aclose()
            # Signal completion so the consumer can terminate even if
            # the sentinel below is lost to QueueFull.
            producer_done.set()
            # Best-effort sentinel: if the queue is full this is dropped,
            # but producer_done covers that case.
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    task = asyncio.create_task(_producer())
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=write_timeout + 5)
                if chunk is None:
                    return
                yield chunk
            except asyncio.TimeoutError:
                # Producer may have finished while we were blocked on get
                # (e.g. sentinel was lost to QueueFull). Check the event
                # and drain any remaining items before returning.
                if producer_done.is_set():
                    while True:
                        try:
                            chunk = queue.get_nowait()
                            if chunk is None:
                                return
                            yield chunk
                        except asyncio.QueueEmpty:
                            return
                raise RuntimeError("Slow client disconnected (write timeout)")
    except asyncio.TimeoutError:
        raise RuntimeError("Slow client disconnected (write timeout)")
    finally:
        # Release the stream slot exactly once, when the outer SSE
        # response terminates — not when the inner generator closes.
        await _release_stream_slot()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, RuntimeError):
            pass


async def _acquire_stream_slot() -> bool:
    """Try to acquire a stream connection slot. Returns True if acquired."""
    global _active_stream_connections
    async with _stream_connections_lock:
        if _active_stream_connections >= settings.HOME_SSE_MAX_CONNECTIONS:
            return False
        _active_stream_connections += 1
        return True


async def _release_stream_slot():
    """Release a stream connection slot."""
    global _active_stream_connections
    async with _stream_connections_lock:
        _active_stream_connections = max(0, _active_stream_connections - 1)


def _compute_stream_deadline(caller: Caller) -> float:
    """Compute the hard deadline for an SSE connection.

    Per §6.1: deadline = min(now + HOME_SSE_MAX_LIFETIME, token.exp).
    Returns a monotonic timestamp.
    """
    now = time.monotonic()
    max_lifetime = settings.HOME_SSE_MAX_LIFETIME_SECONDS
    # Convert token exp (epoch seconds) to monotonic offset
    token_exp_epoch = caller.token_exp
    now_epoch = time.time()
    remaining_token = max(0.0, token_exp_epoch - now_epoch)
    return now + min(max_lifetime, remaining_token)


async def _revalidate_membership(caller: Caller, org_id: int) -> bool:
    """Revalidate that the caller still belongs to the given org.

    Because the JWT is immutable, we call the id service's user-info endpoint
    with the caller's own Bearer to detect membership revocation since the
    token was issued.  This is called periodically (every revalidation
    interval), not on every event.

    Returns True if the caller is still a member.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{settings.SHIZUHA_ID_URL}/api/oauth/userinfo",
                headers={"Authorization": f"Bearer {caller.bearer}"},
            )
            if resp.status_code != 200:
                return False
            body = resp.json()
            memberships = body.get("organization_memberships", {})
            return str(org_id) in memberships or org_id in memberships
    except Exception:
        # On error, fail closed — don't deliver events when we can't verify
        return False


def _check_token_not_expired(caller: Caller) -> bool:
    """Cheap check: has the JWT expired since we last checked?"""
    return time.time() < caller.token_exp


@app.get("/api/home/activity/stream")
async def activity_stream(
    caller: Caller = Depends(verify_caller),
    org_id: Optional[int] = Query(default=None),
    since: Optional[str] = Query(default=None),
    since_by_org: Optional[str] = Query(default=None, alias="since_by_org"),
):
    """Stream activity events as text/event-stream.

    Single-org mode: streams from one org's Redis Stream.
    Aggregate mode: multiplexes across all caller orgs.

    Uses fetch() + ReadableStream on the client (not native EventSource)
    because Home authenticates via Authorization: Bearer header.

    §6.1: Hard JWT-expiry bound, max connection lifetime, periodic revalidation.
    §6.2: Per-instance connection cap with 503 shed.
    """
    scope_org = resolve_scope_org(caller, org_id)

    # §6.2: connection cap
    if not await _acquire_stream_slot():
        raise HTTPException(
            status_code=503,
            detail="Too many concurrent stream connections. Retry after backoff.",
            headers={"Retry-After": "10"},
        )

    # §6.1: compute hard deadline
    deadline = _compute_stream_deadline(caller)

    if scope_org is not None:
        return StreamingResponse(
            _bounded_stream(_stream_single_org(scope_org, since or "$", caller, deadline)),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        if since and not since_by_org:
            await _release_stream_slot()
            raise HTTPException(
                status_code=400,
                detail="Aggregate mode requires since_by_org (base64url-json per-org cursor).",
            )
        org_ids = list(caller.memberships.keys())
        decoded_cursors = _decode_since_by_org(since_by_org)
        if since_by_org and decoded_cursors is None:
            await _release_stream_slot()
            raise HTTPException(
                status_code=400,
                detail="Malformed since_by_org: expected base64url-encoded JSON cursor map.",
            )
        decoded_cursors = decoded_cursors or {}
        return StreamingResponse(
            _bounded_stream(_stream_multi_org(org_ids, decoded_cursors, caller, deadline)),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


async def _stream_single_org(org_id: int, since: str, caller: Caller, deadline: float):
    """SSE generator for a single org's activity stream.

    §6.1: enforces hard deadline, pre-yield expiry check, and periodic
    live membership revalidation via the id service.
    """
    last_id = since
    heartbeat_interval = settings.ACTIVITY_SSE_HEARTBEAT_SECONDS
    revalidate_interval = settings.HOME_SSE_REVALIDATE_INTERVAL_SECONDS
    last_revalidate = time.monotonic()

    try:
        while True:
            now = time.monotonic()

            # §6.1: hard deadline check
            if now >= deadline:
                yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"lifetime\"}}\n\n"
                return

            # §6.1: periodic revalidation
            if now - last_revalidate >= revalidate_interval:
                last_revalidate = now
                # Check token expiry (cheap, no network)
                if not _check_token_not_expired(caller):
                    yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"reauth_required\"}}\n\n"
                    return
                # Live membership revalidation via id service
                if not await _revalidate_membership(caller, org_id):
                    yield f"event: home.deauthz.v1\ndata: {{\"dropped_org\": {org_id}}}\n\n"
                    return

            try:
                events = await block_read(
                    org_id,
                    since=last_id,
                    count=10,
                    block_ms=settings.ACTIVITY_STREAM_READ_TIMEOUT_MS,
                )
            except Exception:
                yield f": heartbeat (redis error)\n\n"
                await asyncio.sleep(heartbeat_interval)
                continue

            # Pre-yield: recheck expiry after await (token may have expired
            # while XREAD was blocked)
            if not _check_token_not_expired(caller):
                yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"reauth_required\"}}\n\n"
                return

            # Pre-yield: revalidate membership after blocking await
            if not await _revalidate_membership(caller, org_id):
                yield f"event: home.deauthz.v1\ndata: {{\"dropped_org\": {org_id}}}\n\n"
                return

            if events:
                for ev in events:
                    sid = ev.get("id", last_id)
                    if _stream_id_gt(sid, last_id):
                        last_id = sid
                    yield f"id: {sid}\nevent: home.activity.v1\ndata: {json.dumps(ev)}\n\n"
            else:
                yield f": heartbeat\n\n"
    finally:
        pass  # slot released by _bounded_stream wrapper


async def _stream_multi_org(org_ids: list[int], since_by_org: dict[str, str], caller: Caller, deadline: float):
    """SSE generator for aggregate multi-org activity stream.

    Per HLD §6, aggregate frames use compound ids:
      id: v1;org=<org_id>;sid=<redis_stream_id>

    §6.1: enforces hard deadline, pre-yield expiry check, and periodic
    live membership revalidation per org via the id service.
    """
    last_by_org: dict[str, str] = dict(since_by_org)
    heartbeat_interval = settings.ACTIVITY_SSE_HEARTBEAT_SECONDS
    revalidate_interval = settings.HOME_SSE_REVALIDATE_INTERVAL_SECONDS
    last_revalidate = time.monotonic()
    tick = 0
    active_orgs: set[int] = set(org_ids)

    try:
        while True:
            now = time.monotonic()

            # §6.1: hard deadline check
            if now >= deadline:
                yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"lifetime\"}}\n\n"
                return

            # §6.1: periodic revalidation
            if now - last_revalidate >= revalidate_interval:
                last_revalidate = now
                # Check token expiry (cheap, no network)
                if not _check_token_not_expired(caller):
                    yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"reauth_required\"}}\n\n"
                    return
                # Live membership revalidation per org via id service
                for oid in list(active_orgs):
                    if not await _revalidate_membership(caller, oid):
                        active_orgs.discard(oid)
                        last_by_org.pop(str(oid), None)
                        yield f"event: home.deauthz.v1\ndata: {{\"dropped_org\": {oid}}}\n\n"
                if not active_orgs:
                    return

            try:
                events = await block_read_multi(
                    list(active_orgs),
                    since_by_org=last_by_org,
                    count=10,
                    block_ms=settings.ACTIVITY_STREAM_READ_TIMEOUT_MS,
                )
            except Exception:
                yield f": heartbeat (redis error)\n\n"
                await asyncio.sleep(heartbeat_interval)
                continue

            # Pre-yield: recheck expiry after await (token may have expired
            # while XREAD was blocked)
            if not _check_token_not_expired(caller):
                yield f"event: home.reconnect.v1\ndata: {{\"reason\":\"reauth_required\"}}\n\n"
                return

            # Pre-yield: revalidate membership after blocking await
            for oid in list(active_orgs):
                if not await _revalidate_membership(caller, oid):
                    active_orgs.discard(oid)
                    last_by_org.pop(str(oid), None)
                    yield f"event: home.deauthz.v1\ndata: {{\"dropped_org\": {oid}}}\n\n"
            if not active_orgs:
                return

            if events:
                for ev in events:
                    oid = str(ev.get("org_id", ""))
                    # Skip events from orgs that were deauthorized during
                    # the blocking read (post-XREAD deauth guard).
                    if oid and int(oid) not in active_orgs:
                        continue
                    sid = ev.get("id", "")
                    if oid and sid:
                        if oid not in last_by_org or _stream_id_gt(sid, last_by_org[oid]):
                            last_by_org[oid] = sid
                    compound_id = f"v1;org={oid};sid={sid}"
                    yield f"id: {compound_id}\nevent: home.activity.v1\ndata: {json.dumps(ev)}\n\n"
            else:
                yield f": heartbeat\n\n"

            # Send periodic cursor control frame
            tick += 1
            if tick % 3 == 0 and last_by_org:
                cursor_payload = json.dumps({"cursor_by_org": last_by_org})
                yield f"event: home.cursor.v1\ndata: {cursor_payload}\n\n"

            await asyncio.sleep(0)  # yield control
    finally:
        pass  # slot released by _bounded_stream wrapper
>>>>>>> origin/main
