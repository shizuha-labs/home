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
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, Query

from .auth import Caller, resolve_scope_org, verify_caller
from .cache import cache_key, widget_cache
from .clients import (
    fetch_agent_activity, fetch_alerts, fetch_financial_snapshot,
    fetch_recent_conversations, fetch_tasks_by_status,
)
from .schema import HomeSummaryV1, OrgRef, SUMMARY_VERSION

app = FastAPI(title="Shizuha Home BFF", version=str(SUMMARY_VERSION))


@app.get("/api/home/health")
async def health():
    return {"status": "ok", "version": SUMMARY_VERSION}


@app.get("/api/home/summary", response_model=HomeSummaryV1)
async def home_summary(
    caller: Caller = Depends(verify_caller),
    org_id: Optional[int] = Query(default=None),
) -> HomeSummaryV1:
    # 403 if the caller asked for an org they don't belong to.
    scope_org = resolve_scope_org(caller, org_id)

    orgs = [OrgRef(id=oid, role=role) for oid, role in caller.memberships.items()]

    # Fan out to downstreams concurrently, forwarding the caller's Bearer. Each
    # client is fail-soft, so a slow/down source degrades only its widget.
    # Cacheable widgets serve recently-good stale data during brownouts.
    async with httpx.AsyncClient() as client:
        tasks_widget, agent_widget, alerts_widget, financial_widget, conversations_widget = await asyncio.gather(
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
