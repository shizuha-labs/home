"""Tiny per-process widget cache for HIVE-375.

The Home BFF is stateless from a persistence perspective; this in-memory cache is
best-effort and safe across replicas. It exists to make one slow/down downstream
serve a recently-good widget as `stale` instead of flashing empty/degraded state.
"""
from __future__ import annotations

import hashlib
import json
import time
import asyncio
import datetime
import math
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from .config import settings
from .schema import Widget, WidgetStatus


@dataclass
class _Entry:
    widget: Widget
    stored_at: float


class WidgetCache:
    def __init__(self):
        self._store: dict[str, _Entry] = {}
        self._snapshots: dict[str, dict] = {}
        self._refresh_tasks: dict[str, asyncio.Task] = {}

    def clear(self):
        self._store.clear()
        self._snapshots.clear()
        for task in self._refresh_tasks.values():
            task.cancel()
        self._refresh_tasks.clear()

    async def get_or_refresh(self, key, fetch, *, fetch_budget=None):
        """Return local state immediately; shared cache and source I/O are async.

        The caller/window key is supplied only after route authorization. Redis
        is a shared snapshot/ownership layer, never an authority source. A
        crashed worker's expiring token cannot publish or unlock its successor.
        """
        from .redis_client import get_redis
        budget = settings.SOURCE_TIMEOUT_SECONDS if fetch_budget is None else fetch_budget
        rkey = 'home:widgets:v1:' + hashlib.sha256(key.encode()).hexdigest()
        entry = self._snapshots.get(key)
        now = time.time()
        if entry and now - entry['checked_at'] <= settings.CACHE_TTL_SECONDS:
            return self._snapshot_widget(entry, now), False
        task = self._refresh_tasks.get(key)
        if task is not None and not task.done():
            return self._snapshot_widget(entry, now), True
        token = uuid.uuid4().hex

        async def refresh():
            rr = None
            previous = entry
            try:
                try:
                    rr = await asyncio.wait_for(get_redis(), settings.SOURCE_TIMEOUT_SECONDS)
                    raw = await asyncio.wait_for(rr.get(rkey), settings.SOURCE_TIMEOUT_SECONDS)
                    if raw:
                        decoded = json.loads(raw)
                        Widget.model_validate(decoded['widget'])
                        float(decoded['checked_at'])
                        float(decoded['observed_at'])
                        previous = decoded
                        self._snapshots[key] = decoded
                        if time.time() - decoded['checked_at'] <= settings.CACHE_TTL_SECONDS:
                            return
                    # Only the shared owner may fetch/publish. Lease covers the
                    # existing fetch and cache I/O budgets; it adds no source wait.
                    lease = math.ceil(budget + 2 * settings.SOURCE_TIMEOUT_SECONDS)
                    won = await asyncio.wait_for(
                        rr.set(rkey + ':lock', token, nx=True, ex=lease),
                        settings.SOURCE_TIMEOUT_SECONDS,
                    )
                    if not won:
                        return
                except Exception:
                    rr = None  # source read still works with local single-flight
                try:
                    widget = await asyncio.wait_for(fetch(), budget)
                except Exception:
                    widget = Widget.degraded_()
                completed = time.time()
                if widget.status in {WidgetStatus.ok, WidgetStatus.empty}:
                    widget = widget.model_copy(update={
                        'as_of': widget.as_of or datetime.datetime.fromtimestamp(
                            completed, datetime.timezone.utc).isoformat(),
                    })
                    observed = completed
                elif widget.status == WidgetStatus.degraded and previous and (
                    completed - previous['observed_at'] <= settings.STALE_TTL_SECONDS
                    and previous['widget']['status'] in {'ok', 'empty', 'stale'}
                ):
                    widget = Widget.stale_(data=previous['widget']['data'],
                                           as_of=previous['widget']['as_of'])
                    observed = previous['observed_at']
                else:
                    # In particular, 403 replaces any previously good value.
                    observed = completed
                result = {'widget': widget.model_dump(mode='json'),
                          'checked_at': completed, 'observed_at': observed}
                if rr is not None:
                    try:
                        published = await asyncio.wait_for(rr.eval(
                            _PUBLISH_WIDGET, 2, rkey + ':lock', rkey, token,
                            json.dumps(result), math.ceil(settings.STALE_TTL_SECONDS),
                        ), settings.SOURCE_TIMEOUT_SECONDS)
                    except Exception:
                        # Cache I/O failure must not discard a valid completed
                        # fetch. This local fallback never overwrites Redis.
                        published = True
                    if not published:
                        return
                self._snapshots[key] = result
            finally:
                if rr is not None:
                    try:
                        await asyncio.wait_for(rr.eval(_RELEASE_WIDGET, 1, rkey + ':lock', token),
                                               settings.SOURCE_TIMEOUT_SECONDS)
                    except Exception:
                        pass
                if self._refresh_tasks.get(key) is asyncio.current_task():
                    self._refresh_tasks.pop(key, None)

        task = asyncio.create_task(refresh(), name='home-progress-refresh')
        self._refresh_tasks[key] = task
        # Retrieve background failures; they never propagate into another GET.
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return self._snapshot_widget(entry, now), True

    @staticmethod
    def _snapshot_widget(entry, now):
        if not entry:
            return Widget(status=WidgetStatus.loading)
        widget = Widget.model_validate(entry['widget'])
        if widget.status in {WidgetStatus.unauthorized, WidgetStatus.degraded}:
            return widget
        if now - entry['observed_at'] > settings.STALE_TTL_SECONDS:
            return Widget.degraded_()
        if now - entry['checked_at'] > settings.CACHE_TTL_SECONDS:
            return Widget.stale_(data=widget.data, as_of=widget.as_of)
        return widget

    def _fresh(self, entry: _Entry, now: float) -> bool:
        return now - entry.stored_at <= settings.CACHE_TTL_SECONDS

    def _stale_allowed(self, entry: _Entry, now: float) -> bool:
        return now - entry.stored_at <= settings.STALE_TTL_SECONDS

    async def get_or_fetch(
        self,
        key: str,
        fetch: Callable[[], Awaitable[Widget]],
        *,
        cache_fresh: bool = True,
    ) -> Widget:
        now = time.monotonic()
        entry = self._store.get(key)
        if cache_fresh and entry and self._fresh(entry, now):
            return entry.widget

        widget = await fetch()
        if widget.status in {WidgetStatus.ok, WidgetStatus.empty}:
            self._store[key] = _Entry(widget=widget, stored_at=time.monotonic())
            return widget

        # Serve stale only for brownout-style failures. Authz outcomes (for
        # example Books 403 -> unauthorized) must never be masked by a cached
        # value from an earlier, more-privileged read.
        if (
            widget.status == WidgetStatus.degraded
            and entry
            and self._stale_allowed(entry, now)
        ):
            return Widget.stale_(data=entry.widget.data, as_of=entry.widget.as_of)
        return widget

    @staticmethod
    def entry_or_fallback(key: str) -> Widget:
        """PLAT-5298: serve the last-good cached widget when the live poll
        exceeded its total budget, or a degraded marker if none is cached.

        Used by the activity poll's hard deadline: the live fan-out may not
        raise (slow-but-succeeding downstream), so get_or_fetch's exception
        path never fires; this gives a bounded fallback without ever turning a
        transient slowness into a visible gateway error or a blank widget.
        """
        entry = widget_cache._store.get(key)
        if entry:
            return Widget.stale_(data=entry.widget.data, as_of=entry.widget.as_of)
        return Widget.degraded_()


widget_cache = WidgetCache()

_PUBLISH_WIDGET = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[1])
return 1
"""
_RELEASE_WIDGET = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def cache_key(
    widget_name: str,
    user_id: int,
    org_id: Optional[int],
    memberships: dict[int, str],
) -> str:
    """Return an authz-bound widget cache key.

    User + selected org alone is insufficient: a refreshed token can remove an
    organization or downgrade a role while retaining the same user id. Without
    the signed membership/role set in the key, that less-privileged request can
    receive a fresh or stale widget produced under the older claim.

    Hash the canonical server-verified claim rather than embedding roles in a
    process-visible key. In selected-org mode only that org's role is relevant;
    aggregate mode binds the complete membership set.
    """
    scope = "all" if org_id is None else str(org_id)
    if org_id is None:
        authorized = sorted((int(oid), str(role)) for oid, role in memberships.items())
    else:
        authorized = [(int(org_id), str(memberships.get(org_id, "")))]
    encoded = json.dumps(authorized, separators=(",", ":"), ensure_ascii=True).encode()
    authz_fingerprint = hashlib.sha256(encoded).hexdigest()[:16]
    return f"{widget_name}:u={user_id}:org={scope}:authz={authz_fingerprint}"
