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
from .schema import OrgRef, Widget

logger = logging.getLogger("home_bff.clients")

# Buckets surfaced by the tasks widget (open ready-work through recently-done).
_TASK_BUCKETS = ("open", "in_progress", "in_review", "blocked", "awaiting_merge")


def _auth_headers(bearer: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {bearer}"}


def _scope_params(org_id: Optional[int] = None) -> dict[str, str]:
    # Pulse scopes ItemViewSet by `organization`, not `org_id`. Keep this helper
    # as the single source for Pulse fan-outs so Home's selected-org envelope
    # cannot be mislabeled while downstream returns cross-org data.
    return {"organization": str(org_id)} if org_id is not None else {}


def _org_header(org_id: Optional[int] = None) -> dict[str, str]:
    return {"X-Organization-ID": str(org_id)} if org_id is not None else {}


def _compact_amount(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _widget_count_status(item: dict) -> str:
    return str(
        item.get("status")
        or item.get("health")
        or item.get("status_label")
        or item.get("state")
        or ""
    ).strip().lower()


async def fetch_org_refs(client: httpx.AsyncClient, bearer: str, user_id: int,
                         email: Optional[str], memberships: dict[int, str]) -> list[OrgRef]:
    """Return JWT-scoped organization refs, hydrated with Admin display names.

    The verified JWT membership claim remains the source of authorization. Admin
    is used only as a best-effort label source so the dashboard never renders
    anonymous "? owner" chips when the token only carries org ids/roles.
    """
    fallback = [
        OrgRef(id=oid, role=role, name=f"Organization {oid}")
        for oid, role in memberships.items()
    ]
    if not memberships:
        return []
    try:
        resp = await client.get(
            f"{settings.ADMIN_API_URL}/internal/users/{user_id}/organizations/",
            headers=_auth_headers(bearer),
            params={"email": email} if email else {},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("org_refs source failed: %s", type(exc).__name__)
        return fallback
    if resp.status_code >= 400:
        logger.warning("org_refs source HTTP %s", resp.status_code)
        return fallback
    try:
        payload = resp.json()
    except ValueError:
        return fallback
    raw_orgs = payload.get("organizations", payload.get("results", payload)) if isinstance(payload, dict) else payload
    names = {}
    for org in raw_orgs or []:
        if not isinstance(org, dict):
            continue
        try:
            oid = int(org.get("id"))
        except (TypeError, ValueError):
            continue
        names[oid] = {
            "name": org.get("name") or org.get("slug") or f"Organization {oid}",
            "slug": org.get("slug"),
        }
    return [
        OrgRef(
            id=oid,
            role=role,
            name=(names.get(oid) or {}).get("name") or f"Organization {oid}",
            slug=(names.get(oid) or {}).get("slug"),
        )
        for oid, role in memberships.items()
    ]


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

    Hive's fleet index is authenticated and owner/staff scoped. Forwarding the
    caller bearer keeps Home read-only and tenant-safe; non-operators receive a
    403/unauthorized widget instead of a global roster leak.
    """
    params = {"page_size": "250"}
    if org_id is not None:
        # Hive currently accepts org_slug on some fleet views; keep this as an
        # additive hint only. The forwarded bearer remains the authorization
        # boundary, and a service that ignores this hint still scopes internally.
        params["organization"] = str(org_id)
    try:
        resp = await client.get(
            f"{settings.HIVE_API_URL}/v1/fleet/agents/",
            headers=_auth_headers(bearer),
            params=params,
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("agent_activity source failed: %s", type(exc).__name__)
        return Widget.degraded_(data={"active": None, "error": None, "total": None})
    if resp.status_code in (401, 403):
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("agent_activity source HTTP %s", resp.status_code)
        return Widget.degraded_(data={"active": None, "error": None, "total": None})
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_(data={"active": None, "error": None, "total": None})
    agents = payload.get("results", payload.get("agents", payload)) if isinstance(payload, dict) else payload
    active = error = stopped = 0
    for agent in agents or []:
        if not isinstance(agent, dict):
            continue
        status = _widget_count_status(agent)
        enabled = agent.get("enabled")
        if status in {"failed", "error", "unavailable", "crashloopbackoff", "needs_help"}:
            error += 1
        elif status in {"stopped", "disabled", "offline"} or enabled is False:
            stopped += 1
        elif status in {"running", "alive", "loaded", "ready", "ok"} or enabled is True:
            active += 1
    total = active + error + stopped
    if total == 0:
        return Widget.empty_()
    return Widget.ok_(data={"active": active, "error": error, "stopped": stopped, "total": total})


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


async def fetch_financial_snapshot(client: httpx.AsyncClient, bearer: str,
                                   org_id: Optional[int] = None) -> Widget:
    """Compact Books dashboard rollup, gated by Books' own org/finance authz.

    Books requires an explicit X-Organization-ID for the dashboard. When Home is
    aggregating across all orgs (org_id omitted), do not guess a finance org —
    ask the user to select one by returning `empty`.
    """
    if org_id is None:
        return Widget.empty_()
    try:
        resp = await client.get(
            f"{settings.BOOKS_API_URL}/dashboard/",
            headers={**_auth_headers(bearer), **_org_header(org_id)},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("financial_snapshot source failed: %s", type(exc).__name__)
        return Widget.degraded_(data=None)
    if resp.status_code == 403:
        return Widget.unauthorized_()
    if resp.status_code == 404:
        return Widget.empty_()
    if resp.status_code >= 400:
        logger.warning("financial_snapshot source HTTP %s", resp.status_code)
        return Widget.degraded_(data=None)
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_(data=None)
    summary = payload.get("summary") if isinstance(payload, dict) else {}
    period = payload.get("period_summary") if isinstance(payload, dict) else {}
    company = payload.get("company") if isinstance(payload, dict) else {}
    data = {
        "company": (company or {}).get("name"),
        "currency": (payload.get("currency") if isinstance(payload, dict) else None) or "INR",
        "cash": _compact_amount((summary or {}).get("total_cash")),
        "receivables": _compact_amount((summary or {}).get("receivables", {}).get("amount") if isinstance((summary or {}).get("receivables"), dict) else None),
        "payables": _compact_amount((summary or {}).get("payables", {}).get("amount") if isinstance((summary or {}).get("payables"), dict) else None),
        "period_net": _compact_amount((period or {}).get("net")),
        "period_income": _compact_amount((period or {}).get("income")),
        "period_expenses": _compact_amount((period or {}).get("expenses")),
    }
    return Widget.ok_(data=data)


async def fetch_recent_conversations(client: httpx.AsyncClient, bearer: str,
                                     org_id: Optional[int] = None) -> Widget:
    """Recent Connect conversations visible to the caller.

    Connect's conversations endpoint scopes to the authenticated participant via
    the forwarded bearer, but it does not yet accept a selected-organization
    filter. When Home is scoped to one org, surfacing unfiltered conversation
    metadata/previews would leak another org's activity into that org summary;
    degrade the widget until Connect exposes an org-scoped list endpoint.
    """
    if org_id is not None:
        logger.info("recent_conversations disabled until Connect exposes a scoped endpoint")
        return Widget.degraded_(data=[])

    try:
        resp = await client.get(
            f"{settings.CONNECT_API_URL}/conversations/",
            headers=_auth_headers(bearer),
            params={"limit": "5", "page_size": "5"},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("recent_conversations source failed: %s", type(exc).__name__)
        return Widget.degraded_(data=[])
    if resp.status_code == 403:
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("recent_conversations source HTTP %s", resp.status_code)
        return Widget.degraded_(data=[])
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_(data=[])
    conversations = payload.get("results", payload) if isinstance(payload, dict) else payload
    out = []
    for conv in (conversations or [])[:5]:
        if not isinstance(conv, dict):
            continue
        names = conv.get("participant_names") or []
        title = conv.get("name") or (", ".join(names[:3]) if names else "Conversation")
        out.append({
            "id": conv.get("id"),
            "title": title,
            "type": conv.get("conversation_type"),
            "unread": conv.get("unread_count", 0),
            "last_at": conv.get("last_message_at"),
            "last_preview": conv.get("last_message_preview") or ((conv.get("last_message") or {}).get("content") if isinstance(conv.get("last_message"), dict) else None),
        })
    if not out:
        return Widget.empty_()
    return Widget.ok_(data=out)
