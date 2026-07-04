"""Tiny per-process widget cache for HIVE-375.

The Home BFF is stateless from a persistence perspective; this in-memory cache is
best-effort and safe across replicas. It exists to make one slow/down downstream
serve a recently-good widget as `stale` instead of flashing empty/degraded state.
"""
from __future__ import annotations

import time
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

    def clear(self):
        self._store.clear()

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


widget_cache = WidgetCache()


def cache_key(widget_name: str, user_id: int, org_id: Optional[int]) -> str:
    scope = "all" if org_id is None else str(org_id)
    return f"{widget_name}:u={user_id}:org={scope}"
