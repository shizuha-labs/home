"""HIVE-375 downstream clients — async, per-source-timeout, fail-soft.

Each client FORWARDS the caller's Bearer (never a privileged token) so the
downstream service applies its own authz; the BFF cannot widen scope. A
timeout/error never raises to the request path — it returns a degraded Widget,
so one slow/down source degrades only its own widget (async-frontends doctrine).
"""
import asyncio
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
        # This admin endpoint is on the INTERNAL control plane: it authorizes a
        # service identity and EXPLICITLY REJECTS a forwarded user bearer (a
        # tenant JWT is never a substitute for service auth there). Authorization
        # here already comes from the verified JWT membership claim above — admin
        # is only a best-effort name source — so call it as the shizuha-home
        # service (+ service token when configured; the compat branch accepts the
        # named service today) instead of forwarding the caller's bearer, which
        # would 403 and leave every org labelled "Organization <id>".
        svc_headers = {"X-Internal-Service": "shizuha-home"}
        svc_token = getattr(settings, "ADMIN_INTERNAL_SERVICE_TOKEN", "") or ""
        if svc_token:
            svc_headers["X-Internal-Service-Token"] = svc_token
        resp = await client.get(
            f"{settings.ADMIN_API_URL}/internal/users/{user_id}/organizations/",
            headers=svc_headers,
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


def _task_bucket(item: dict) -> Optional[str]:
    """Map an item to a display bucket via its NORMALIZED status_category,
    with slug pins for the stage buckets the dashboard breaks out.

    Pulse status slugs are workflow-customizable (new items even default to
    'pending'), so a raw slug match against the five bucket literals silently
    dropped almost everything — the HIVE-373 "Pending work: all zeros" bug.
    """
    slug = str((item or {}).get("status") or "").strip().lower()
    cat = str((item or {}).get("status_category") or "").strip().lower()
    if slug == "awaiting_merge":
        return "awaiting_merge"
    if slug in ("in_review", "review"):
        return "in_review"
    if slug == "blocked":
        return "blocked"
    if cat == "todo":
        return "open"
    if cat == "in_progress":
        return "in_progress"
    if not cat:
        # Legacy rows whose slug has no Status table entry.
        if slug in _TASK_BUCKETS:
            return slug
        if slug in ("open", "todo", "pending", "backlog", "ready", "new"):
            return "open"
    return None  # done / scheduled / unknown — not pending work


async def fetch_tasks_by_status(client: httpx.AsyncClient, bearer: str,
                                email: Optional[str],
                                org_id: Optional[int] = None,
                                org_ids: Optional[list] = None) -> Widget:
    """Count the org's ACTIVE (non-terminal) work in flight by stage via pulse,
    forwarding the caller's Bearer. Pulse resolves the user from the token and
    applies its own scoping — the BFF passes no privileged token and never
    widens scope.

    HIVE-373 operator follow-up (2026-07-10): this is the command center's
    "work is happening" signal, so it counts ALL work the caller may see in
    the scoped org(s) — agents do the work autonomously, so the previous
    assignee_email=<caller> filter hid essentially everything. When no org is
    selected, fan out across the caller's org memberships and sum.
    """
    headers = _auth_headers(bearer)
    scopes = [org_id] if org_id is not None else list(org_ids or [])[:8]
    if not scopes:
        scopes = [None]  # org-less caller: personal member-visible items

    counts = {b: 0 for b in _TASK_BUCKETS}
    total = 0
    any_ok = False
    any_forbidden = False
    for scope in scopes:
        params = {"limit": "200", "mode": "task", "is_active": "true",
                  **_scope_params(scope)}
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
            any_forbidden = True
            continue  # skip orgs the token can't read; count the rest
        if resp.status_code >= 400:
            logger.warning("tasks_by_status source HTTP %s", resp.status_code)
            return Widget.degraded_(data={b: None for b in _TASK_BUCKETS})
        try:
            payload = resp.json()
        except ValueError:
            return Widget.degraded_()
        items = payload.get("results", payload) if isinstance(payload, dict) else payload
        any_ok = True
        for it in items or []:
            bucket = _task_bucket(it)
            if bucket:
                counts[bucket] += 1
            total += 1
    if not any_ok:
        return Widget.unauthorized_() if any_forbidden else Widget.degraded_()
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


async def fetch_live_feed(client: httpx.AsyncClient, bearer: str,
                          org_ids: Optional[list] = None,
                          since: Optional[str] = None,
                          limit: int = 60) -> Widget:
    """HIVE-602: merged newest-first event stream (Pulse activity + comments)
    across the caller's orgs — the home theater's heartbeat. Fan out per org to
    Pulse `/api/items/activity-feed/` (HIVE-603 endpoint), merge, cap."""
    headers = _auth_headers(bearer)
    scopes = list(org_ids or [])[:8] or [None]
    events: list = []
    any_ok = False
    for scope in scopes:
        params = {"limit": str(min(limit, 100)), **_scope_params(scope)}
        if since:
            params["since"] = since
        try:
            resp = await client.get(
                f"{settings.PULSE_API_URL}/api/items/activity-feed/",
                headers=headers, params=params,
                timeout=settings.SOURCE_TIMEOUT_SECONDS,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            logger.warning("live_feed source failed: %s", type(exc).__name__)
            return Widget.degraded_()
        if resp.status_code in (401, 403):
            continue
        if resp.status_code >= 400:
            logger.warning("live_feed source HTTP %s", resp.status_code)
            return Widget.degraded_()
        try:
            payload = resp.json()
        except ValueError:
            return Widget.degraded_()
        any_ok = True
        for ev in (payload.get("results") or []):
            if isinstance(ev, dict):
                ev["org_id"] = scope
                events.append(ev)
    if not any_ok:
        return Widget.unauthorized_()
    events.sort(key=lambda e: str(e.get("at") or ""), reverse=True)
    events = events[:limit]
    if not events:
        return Widget.empty_()
    return Widget.ok_(data=events)


async def fetch_agents_live(client: httpx.AsyncClient, bearer: str,
                            org_id: Optional[int] = None) -> Widget:
    """HIVE-602: the fleet as live entities for the agents-at-work strip —
    name, role, teams, model, state, freshness. Same authz model as
    fetch_agent_activity (forwarded bearer; 403 → unauthorized widget)."""
    try:
        resp = await client.get(
            f"{settings.HIVE_API_URL}/v1/fleet/agents/",
            headers=_auth_headers(bearer),
            # Selected-org Home responses must not silently become a global
            # fleet response. Hive remains the enforcing downstream; this is a
            # server-derived narrowing hint, never a client authority.
            params={"page_size": "250", **_scope_params(org_id)},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("agents_live source failed: %s", type(exc).__name__)
        return Widget.degraded_()
    if resp.status_code in (401, 403):
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("agents_live source HTTP %s", resp.status_code)
        return Widget.degraded_()
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_()
    rows = payload.get("results", payload.get("agents", payload)) if isinstance(payload, dict) else payload
    agents = []
    for a in rows or []:
        if not isinstance(a, dict):
            continue
        status = _widget_count_status(a)
        agents.append({
            "name": a.get("display_name") or a.get("agent_username") or "",
            "username": a.get("agent_username") or "",
            "email": a.get("email") or "",
            "role": a.get("role") or a.get("display_title") or "",
            "teams": a.get("team_names") or [],
            "model": a.get("effective_model") or a.get("model") or "",
            "harness": a.get("runtime_harness") or "",
            "status": status,
            "enabled": a.get("enabled"),
            "last_active_at": a.get("last_active_at"),
        })
    if not agents:
        return Widget.empty_()
    # Working agents first, then by name, so the strip leads with the action.
    agents.sort(key=lambda x: (x["status"] != "running", x["name"].lower()))
    return Widget.ok_(data=agents)


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


# ── HIVE-602 cockpit drill-downs ─────────────────────────────────────────────
# On-demand peeks (no cache): agent detail, org team map, task detail. Same
# tenant model as everything else here — forwarded caller Bearer only.

async def fetch_agent_peek(client: httpx.AsyncClient, bearer: str,
                           email: str) -> Widget:
    """One agent's active tasks + recent events for the agent drawer."""
    headers = _auth_headers(bearer)
    email = (email or "").strip().lower()
    if not email:
        return Widget.empty_()
    # The assignee-tasks query is Pulse's slowest read (~2.5s of permission
    # scoping); give this drawer fetch a wider budget than the default source
    # timeout (nginx caps /api/home/ at 5s total) and degrade PARTIALLY — one
    # slow source must not blank the other.
    tasks_resp, feed_resp = await asyncio.gather(
        client.get(f"{settings.PULSE_API_URL}/api/items/",
                   headers=headers,
                   params={"limit": "10", "mode": "task", "is_active": "true",
                           "assignee_email": email},
                   timeout=4.0),
        client.get(f"{settings.PULSE_API_URL}/api/items/activity-feed/",
                   headers=headers,
                   params={"limit": "20", "actor": email},
                   timeout=settings.SOURCE_TIMEOUT_SECONDS),
        return_exceptions=True,
    )
    if isinstance(tasks_resp, BaseException) and isinstance(feed_resp, BaseException):
        logger.warning("agent_peek both sources failed: %s / %s",
                       type(tasks_resp).__name__, type(feed_resp).__name__)
        return Widget.degraded_()
    if (not isinstance(tasks_resp, BaseException) and tasks_resp.status_code in (401, 403)
            and not isinstance(feed_resp, BaseException) and feed_resp.status_code in (401, 403)):
        return Widget.unauthorized_()
    tasks = []
    if not isinstance(tasks_resp, BaseException) and tasks_resp.status_code < 400:
        try:
            payload = tasks_resp.json()
            rows = payload.get("results", payload) if isinstance(payload, dict) else payload
            for it in rows or []:
                if isinstance(it, dict):
                    tasks.append({
                        "key": it.get("item_key"), "title": it.get("title"),
                        "status": it.get("status"),
                        "status_category": it.get("status_category"),
                        "team": it.get("assignment_group"),
                    })
        except ValueError:
            pass
    events = []
    if not isinstance(feed_resp, BaseException) and feed_resp.status_code < 400:
        try:
            events = (feed_resp.json() or {}).get("results") or []
        except ValueError:
            pass
    if not tasks and not events:
        return Widget.empty_()
    return Widget.ok_(data={"tasks": tasks, "events": events})


async def fetch_org_map(client: httpx.AsyncClient, bearer: str,
                        org_slug: str) -> Widget:
    """Teams-in-org peek: team list + live workload from the Hive fleet
    snapshot (staff/owner-scoped downstream; others get unauthorized)."""
    if not org_slug:
        return Widget.empty_()
    try:
        resp = await client.get(
            f"{settings.HIVE_API_URL}/v1/fleet/pulse-snapshot",
            headers=_auth_headers(bearer),
            params={"org": org_slug},
            timeout=settings.SOURCE_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("org_map source failed: %s", type(exc).__name__)
        return Widget.degraded_()
    if resp.status_code in (401, 403):
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        logger.warning("org_map source HTTP %s", resp.status_code)
        return Widget.degraded_()
    try:
        payload = resp.json()
    except ValueError:
        return Widget.degraded_()
    team_workload = payload.get("team_workload") or {}
    scoped = payload.get("workload_by_assignee_team") or {}
    teams = []
    for t in payload.get("teams") or []:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        name = t.get("name") or ""
        slug = str(name).strip().lower().replace(" ", "-")
        members = sorted({
            k.split("::", 1)[0] for k in scoped
            if k.endswith(f"::{slug}")
        })
        teams.append({
            "id": tid, "name": name,
            "workload": team_workload.get(str(tid)) or team_workload.get(slug) or {},
            "members": members,
        })
    if not teams:
        return Widget.empty_()
    return Widget.ok_(data={"teams": teams})


async def fetch_task_peek(client: httpx.AsyncClient, bearer: str,
                          key: str) -> Widget:
    """Task drawer: one item by human key + its recent activity + comments."""
    headers = _auth_headers(bearer)
    key = (key or "").strip()
    if not key:
        return Widget.empty_()
    try:
        resp = await client.get(f"{settings.PULSE_API_URL}/api/items/",
                                headers=headers,
                                params={"item_key": key, "limit": "1"},
                                timeout=settings.SOURCE_TIMEOUT_SECONDS)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("task_peek source failed: %s", type(exc).__name__)
        return Widget.degraded_()
    if resp.status_code in (401, 403):
        return Widget.unauthorized_()
    if resp.status_code >= 400:
        return Widget.degraded_()
    try:
        payload = resp.json()
        rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    except ValueError:
        return Widget.degraded_()
    if not rows:
        return Widget.empty_()
    it = rows[0]
    if str(it.get("item_key") or "").lower() != key.lower():
        # item_key param unsupported downstream would return an unrelated page;
        # never show the wrong task in the drawer.
        return Widget.empty_()
    item = {
        "key": it.get("item_key"), "title": it.get("title"),
        "status": it.get("status"), "status_category": it.get("status_category"),
        "assignee": it.get("assignee_email"), "team": it.get("assignment_group"),
        "updated_at": it.get("updated_at"),
    }
    activity, comments = [], []
    try:
        act_resp, com_resp = await asyncio.gather(
            client.get(f"{settings.PULSE_API_URL}/api/items/{it.get('id')}/activity/",
                       headers=headers, params={"limit": "15"},
                       timeout=settings.SOURCE_TIMEOUT_SECONDS),
            client.get(f"{settings.PULSE_API_URL}/api/comments/",
                       headers=headers, params={"item": str(it.get("id")), "limit": "10"},
                       timeout=settings.SOURCE_TIMEOUT_SECONDS),
        )
        if act_resp.status_code < 400:
            activity = (act_resp.json() or {}).get("results") or []
            activity = [{
                "action": a.get("action"), "at": a.get("created_at"),
                "actor": a.get("user_email"), "field": a.get("field_name"),
                "old": a.get("old_value"), "new": a.get("new_value"),
            } for a in activity[:15] if isinstance(a, dict)]
        if com_resp.status_code < 400:
            cpayload = com_resp.json()
            crows = cpayload.get("results", cpayload) if isinstance(cpayload, dict) else cpayload
            comments = [{
                "author": c.get("author_email"), "at": c.get("created_at"),
                "excerpt": (c.get("content") or "")[:300],
            } for c in (crows or [])[:10] if isinstance(c, dict)]
    except (httpx.TimeoutException, httpx.TransportError, ValueError):
        pass  # drawer degrades to the item header alone
    return Widget.ok_(data={"item": item, "activity": activity, "comments": comments})
