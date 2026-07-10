"""HIVE-603 Redis Streams client for the activity feed.

Provides async helpers to read recent history and block-read live events from
per-org Redis Streams. Each org gets its own stream key:
  home:activity:v1:org:{org_id}

Stream entries are JSON-serialised HomeActivityEventV1 payloads. Redis Stream
ids serve as monotonic cursors for pagination and reconnect replay.

Uses a **persistent connection pool** (not per-call open/close) to avoid
connection churn.  Blocking XREAD uses a separate connection with a longer
timeout so the pool is not starved.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger("home_bff.redis_client")

# Persistent connection pool for non-blocking reads
_pool: aioredis.ConnectionPool | None = None
# Separate connection for blocking reads (needs longer socket_timeout)
_block_pool: aioredis.ConnectionPool | None = None


def reset_pools() -> None:
    """Reset connection pools (for testing)."""
    global _pool, _block_pool
    _pool = None
    _block_pool = None


def _get_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=5,
            max_connections=20,
        )
    return _pool


def _get_block_pool() -> aioredis.ConnectionPool:
    global _block_pool
    if _block_pool is None:
        _block_pool = aioredis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            # Blocking reads need a longer timeout than the XREAD block_ms
            socket_timeout=settings.ACTIVITY_STREAM_READ_TIMEOUT_MS / 1000 + 5,
            max_connections=10,
        )
    return _block_pool


def _stream_key(org_id: int) -> str:
    return f"{settings.ACTIVITY_STREAM_PREFIX}{org_id}"


async def get_redis() -> aioredis.Redis:
    """Return a Redis connection from the persistent pool (non-blocking reads)."""
    return aioredis.Redis(connection_pool=_get_pool())


async def get_block_redis() -> aioredis.Redis:
    """Return a Redis connection from the blocking-read pool."""
    return aioredis.Redis(connection_pool=_get_block_pool())


async def read_recent(
    org_id: int,
    limit: int = 50,
    since: Optional[str] = None,
) -> list[dict]:
    """Read recent events from a single org's stream.

    Args:
        org_id: The org whose stream to read.
        limit: Max events to return.
        since: If set, return events AFTER this stream id (exclusive).
               If None, return the most recent events.

    Returns:
        List of parsed event dicts (with 'id' and 'data' keys merged).
    """
    r = await get_redis()
    try:
        if since:
            # Read forward from the cursor (exclusive).
            results = await r.xrange(
                _stream_key(org_id),
                min=f"({since}",  # exclusive
                max="+",
                count=limit,
            )
        else:
            # Read the most recent events in reverse, then reverse the list.
            results = await r.xrevrange(
                _stream_key(org_id),
                max="+",
                min="-",
                count=limit,
            )
            results = list(reversed(results))

        events = []
        for stream_id, data in results:
            event = _parse_entry(stream_id, data, expected_org=org_id)
            if event:
                events.append(event)
        return events
    except aioredis.RedisError as exc:
        logger.warning("Redis read_recent failed for org %s: %s", org_id, exc)
        raise


async def read_recent_multi(
    org_ids: list[int],
    limit_per_org: int = 50,
    since_by_org: Optional[dict[str, str]] = None,
) -> list[dict]:
    """Read recent events across multiple orgs, merging by occurred_at.

    Args:
        org_ids: Orgs to read from.
        limit_per_org: Max events per org.
        since_by_org: Per-org cursors {org_id_str: stream_id}.

    Returns:
        Merged, time-sorted list of event dicts.
    """
    since_by_org = since_by_org or {}
    all_events: list[dict] = []
    degraded: list[str] = []

    r = await get_redis()
    for oid in org_ids:
        sid = str(oid)
        cursor = since_by_org.get(sid)
        try:
            if cursor:
                results = await r.xrange(
                    _stream_key(oid),
                    min=f"({cursor}",
                    max="+",
                    count=limit_per_org,
                )
            else:
                results = await r.xrevrange(
                    _stream_key(oid),
                    max="+",
                    min="-",
                    count=limit_per_org,
                )
                results = list(reversed(results))

            for stream_id, data in results:
                event = _parse_entry(stream_id, data, expected_org=oid)
                if event:
                    all_events.append(event)
        except aioredis.RedisError as exc:
            logger.warning("Redis read_recent_multi failed for org %s: %s", oid, exc)
            degraded.append(sid)

    # Sort by occurred_at, then stream id for determinism.
    all_events.sort(key=lambda e: (e.get("occurred_at", ""), e.get("id", "")))
    return all_events, degraded


async def block_read(
    org_id: int,
    since: str,
    count: int = 10,
    block_ms: int = 30000,
) -> list[dict]:
    """Block-read new events from a single org's stream.

    Args:
        org_id: The org whose stream to read.
        since: Stream id to read after (exclusive). Use "$" for latest.
        count: Max events per read.
        block_ms: Max milliseconds to block.

    Returns:
        List of new event dicts, or empty list on timeout.
    """
    r = await get_block_redis()
    try:
        results = await r.xread(
            streams={_stream_key(org_id): since},
            count=count,
            block=block_ms,
        )
        events = []
        for stream_name, entries in results:
            for stream_id, data in entries:
                event = _parse_entry(stream_id, data, expected_org=org_id)
                if event:
                    events.append(event)
        return events
    except aioredis.RedisError as exc:
        logger.warning("Redis block_read failed for org %s: %s", org_id, exc)
        return []


async def block_read_multi(
    org_ids: list[int],
    since_by_org: dict[str, str],
    count: int = 10,
    block_ms: int = 30000,
) -> list[dict]:
    """Block-read new events across multiple orgs.

    Args:
        org_ids: Orgs to read from.
        since_by_org: Per-org cursors {org_id_str: stream_id}.
        count: Max events per org per read.
        block_ms: Max milliseconds to block.

    Returns:
        Merged, time-sorted list of new event dicts.
    """
    # Build stream key -> org_id mapping for cross-tenant validation
    stream_to_org: dict[str, int] = {}
    streams = {}
    for oid in org_ids:
        sid = str(oid)
        cursor = since_by_org.get(sid, "$")
        key = _stream_key(oid)
        streams[key] = cursor
        stream_to_org[key] = oid

    r = await get_block_redis()
    try:
        results = await r.xread(
            streams=streams,
            count=count,
            block=block_ms,
        )
        events = []
        for stream_name, entries in results:
            expected_org = stream_to_org.get(stream_name)
            for stream_id, data in entries:
                event = _parse_entry(stream_id, data, expected_org=expected_org)
                if event:
                    events.append(event)
        events.sort(key=lambda e: (e.get("occurred_at", ""), e.get("id", "")))
        return events
    except aioredis.RedisError as exc:
        logger.warning("Redis block_read_multi failed: %s", exc)
        return []


def _parse_entry(stream_id: str, data: dict, expected_org: Optional[int] = None) -> Optional[dict]:
    """Parse a Redis Stream entry into an event dict.

    The stream stores the JSON-serialised event body. We merge the stream id
    into the parsed dict so the caller has it available.

    Args:
        stream_id: The Redis Stream entry id.
        data: The raw field dict from the stream entry.
        expected_org: If set, the parsed event's ``org_id`` must match this
            value exactly.  A mismatch is logged and dropped (prevents a
            producer mistake from leaking cross-org events).

    Returns:
        Parsed event dict, or None if parsing failed or org_id mismatched.
    """
    raw = data.get("event") or data.get("data") or (list(data.values())[0] if data else None)
    if not raw:
        return None
    try:
        if isinstance(raw, str):
            parsed = json.loads(raw)
        elif isinstance(raw, dict):
            parsed = raw
        else:
            return None
        parsed["id"] = stream_id

        # Validate org_id matches the expected stream key (P1 cross-tenant guard)
        if expected_org is not None:
            event_org = parsed.get("org_id")
            if event_org != expected_org:
                logger.warning(
                    "Dropping entry %s: event.org_id=%s does not match expected org=%s",
                    stream_id, event_org, expected_org,
                )
                return None

        return parsed
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("Failed to parse stream entry %s: %s", stream_id, exc)
        return None
