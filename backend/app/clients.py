"""HIVE-375 downstream clients — async, per-source-timeout, fail-soft.

Each client FORWARDS the caller's Bearer (never a privileged token) so the
downstream service applies its own authz; the BFF cannot widen scope. A
timeout/error never raises to the request path — it returns a degraded Widget,
so one slow/down source degrades only its own widget (async-frontends doctrine).
"""
import logging
from typing import Optional

import httpx

from .config import settings
from .schema import Widget, WidgetStatus

logger = logging.getLogger("home_bff.clients")

# Buckets surfaced by the tasks widget (open ready-work through recently-done).
_TASK_BUCKETS = ("open", "in_progress", "in_review", "blocked", "awaiting_merge")


def _auth_headers(bearer: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {bearer}"}


def _scope_params(org_id: Optional[int] = None) -> dict[str, str]:
    return {"org_id": str(org_id)} if org_id is not None else {}


async def fetch_tasks_by_status(client: httpx.AsyncClient, bearer: str,
                                email: Optional[str],
                                org_id: Optional[int] = None) -> Widget:
    """Count the caller's assigned tasks by status via pulse, forwarding the
    caller's Bearer. Pulse resolves the user from the token and applies its own
    scoping — the BFF passes no privileged token and never widens scope."""
    headers = _auth_headers(bearer)
    params = {"limit": "200", **_scope_params(org_id)}
    if email:
        params["assignee_email"] = email
    try:
        resp = await client.get(
            f"{settings.PULSE_API_URL}/api/items/",
            headers=headers, params=params,
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("tasks_by_status source failed: %s", type(exc).__name__)
        return Widget.degraded_(data={b: None for b in _TASK_BUCKETS})
    if resp.status_code == 403:
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("tasks_by_status source HTTP %s", resp.status_code)
        return Widget.degraded_(data={b: None for b in _TASK_BUCKETS})
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_()
    items = payload.get("results", payload) if isinstance(payload, dict) else payload
    counts = {b: 0 for b in _TASK_BUCKETS}
    total = 0
    for it in items or []:
        st = str((it or {}).get("status", "")).lower()
        if st in counts:
            counts[st] += 1
        total += 1
    if total == 0:
        return Widget.empty_()
    return Widget.ok_(data=counts)


async def fetch_agent_activity(client: httpx.AsyncClient, bearer: str,
                               org_id: Optional[int] = None) -> Widget:
    """Compact live agent rollup for the command center.

    Pulse owns roster/task/health state via `agent_overview`; this BFF only
    forwards the caller's Bearer and reduces it to the frontend's contract:
    `{active, error}`. A downstream 403 means the caller cannot see org agent
    activity; source failures degrade only this widget.
    """
    try:
        resp = await client.get(
            f"{settings.PULSE_API_URL}/api/items/agent_overview/",
            headers=_auth_headers(bearer),
            params=_scope_params(org_id),
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("agent_activity source failed: %s", type(exc).__name__)
        return Widget.degraded_(data={"active": None, "error": None})
    if resp.status_code == 403:
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("agent_activity source HTTP %s", resp.status_code)
        return Widget.degraded_(data={"active": None, "error": None})
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_(data={"active": None, "error": None})
    active = 0
    error = 0
    for team in payload.get("teams", []) if isinstance(payload, dict) else []:
        for agent in (team or {}).get("agents", []) or []:
            health = (agent or {}).get("health") or {}
            status = str(health.get("status") or health.get("state") or "").lower()
            is_error = (
                status in {"error", "down", "stopped", "unhealthy", "wedged"}
                or bool(health.get("auth_errors"))
            )
            if is_error:
                error += 1
            else:
                # Count agents with work or an explicitly healthy/active signal as active.
                if (agent or {}).get("active", 0) or status in {"active", "ok", "healthy", "up", "running"}:
                    active += 1
    if active == 0 and error == 0:
        return Widget.empty_()
    return Widget.ok_(data={"active": active, "error": error},
                      as_of=(payload.get("generated_at") if isinstance(payload, dict) else None))


async def fetch_alerts(client: httpx.AsyncClient, bearer: str,
                       org_id: Optional[int] = None) -> Widget:
    """Return a compact active-alert list for the home dashboard."""
    try:
        resp = await client.get(
            f"{settings.PULSE_API_URL}/api/items/alerts/",
            headers=_auth_headers(bearer),
            params={"limit": "20", **_scope_params(org_id)},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("alerts source failed: %s", type(exc).__name__)
        return Widget.degraded_(data=[])
    if resp.status_code == 403:
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("alerts source HTTP %s", resp.status_code)
        return Widget.degraded_(data=[])
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_(data=[])
    raw_alerts = payload.get("alerts", payload) if isinstance(payload, dict) else payload
    alerts = []
    for alert in (raw_alerts or [])[:20]:
        if not isinstance(alert, dict):
            continue
        alerts.append({
            "sev": alert.get("severity") or alert.get("priority") or "info",
            "summary": alert.get("summary") or alert.get("title") or alert.get("item_key") or "Alert",
        })
    if not alerts:
        return Widget.empty_()
    return Widget.ok_(data=alerts)
