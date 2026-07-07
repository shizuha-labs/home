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
    fetch_agent_activity, fetch_alerts, fetch_financial_snapshot,
    fetch_org_refs, fetch_recent_conversations, fetch_tasks_by_status,
)
from .audit_leads import AuditLeadRequest, AuditLeadResponse, persist_audit_lead
from .config import settings
from .schema import HomeSummaryV1, SUMMARY_VERSION

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
                lambda: fetch_tasks_by_status(client, caller.bearer, caller.email, scope_org),
            ),
            fetch_agent_activity(client, caller.bearer, scope_org),
            widget_cache.get_or_fetch(
                cache_key("alerts", caller.user_id, scope_org),
                lambda: fetch_alerts(client, caller.bearer, scope_org),
            ),
            widget_cache.get_or_fetch(
                cache_key("financial_snapshot", caller.user_id, scope_org),
                lambda: fetch_financial_snapshot(client, caller.bearer, scope_org),
                cache_fresh=False,
            ),
            widget_cache.get_or_fetch(
                cache_key("recent_conversations", caller.user_id, scope_org),
                lambda: fetch_recent_conversations(client, caller.bearer, scope_org),
            ),
        )

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
