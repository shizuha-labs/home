"""HIVE-375 home BFF (slice 1) — GET /api/home/summary.

A thin stateless async fan-out (aoi-approved: FastAPI thin-async-BFF, stateless
only, forward-caller-JWT). Slice 1 surfaces: `orgs` (from the verified JWT claim,
no downstream call) + `tasks_by_status` (pulse, forwarded Bearer). The envelope
is versioned (HomeSummaryV1) and always 200 (partial); auth failures are 401/403.

Tenant isolation (the load-bearing control): identity + org scope come only from
the *verified* token; a requested org must be one the caller belongs to (403
otherwise); downstreams receive the caller's own Bearer so each applies its own
authz — the BFF holds no privileged token and can never widen scope / leak
cross-org. (STRIDE-lite on the task; PLAT-1236 cross-org→403 tests below.)
"""
import asyncio
import datetime
import time
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .auth import Caller, resolve_scope_org, verify_caller
from .cache import cache_key, widget_cache
from .clients import (
    fetch_agent_activity, fetch_agents_live, fetch_alerts,
    fetch_financial_snapshot, fetch_live_feed, fetch_org_refs,
    fetch_recent_conversations, fetch_tasks_by_status,
)
from .audit_leads import AuditLeadRequest, AuditLeadResponse, persist_audit_lead
from .config import settings
from .schema import HomeActivityV1, HomeSummaryV1, SUMMARY_VERSION

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
                cache_key("tasks_by_status", caller.user_id, scope_org),
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
                cache_key("alerts", caller.user_id, scope_org),
                lambda: fetch_alerts(client, caller.bearer, scope_org),
            ),
            widget_cache.get_or_fetch(
                # Books requires a concrete org; with none selected, default to
                # the caller's first org so the panel is never a dead
                # "select an organization" tile (HIVE-602: no inert panels).
                cache_key("financial_snapshot", caller.user_id,
                          scope_org if scope_org is not None else _first_org(caller)),
                lambda: fetch_financial_snapshot(
                    client, caller.bearer,
                    scope_org if scope_org is not None else _first_org(caller)),
                cache_fresh=False,
            ),
            widget_cache.get_or_fetch(
                cache_key("recent_conversations", caller.user_id, scope_org),
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
                cache_key("live_feed", caller.user_id, scope_org),
                lambda: fetch_live_feed(client, caller.bearer, org_ids=feed_orgs),
                cache_fresh=False,
            )
        feed_widget, agents_widget = await asyncio.gather(
            feed_coro,
            widget_cache.get_or_fetch(
                cache_key("agents_live", caller.user_id, scope_org),
                lambda: fetch_agents_live(client, caller.bearer),
                cache_fresh=False,
            ),
        )

    return HomeActivityV1(
        generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        org_id=scope_org,
        widgets={"feed": feed_widget, "agents": agents_widget},
    )
