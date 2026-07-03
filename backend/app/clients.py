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


async def fetch_tasks_by_status(client: httpx.AsyncClient, bearer: str,
                                email: Optional[str]) -> Widget:
    """Count the caller's assigned tasks by status via pulse, forwarding the
    caller's Bearer. Pulse resolves the user from the token and applies its own
    scoping — the BFF passes no privileged token and never widens scope."""
    headers = {"Authorization": f"Bearer {bearer}"}
    params = {"limit": "200"}
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
