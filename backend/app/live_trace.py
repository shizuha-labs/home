"""First-party Live / voice traces.

Browser batches land on POST /api/home/live-trace and are stored on Redis
Streams keyed by the verified caller. GET returns those events, optionally
merged with Connect messages for the same conversation so an investigation
has one timeline.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional

import httpx
import redis.asyncio as aioredis

from .config import settings
from .redis_client import get_redis

logger = logging.getLogger("home_bff.live_trace")

NAME_RE = re.compile(r"^[a-z][a-z0-9_.]{1,80}$")
SECRET_KEY = re.compile(r"token|password|authorization|secret|cookie|bearer", re.I)
SECRET_VALUE = re.compile(
    r"github_pat_|ghp_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{12,}|Bearer\s+\S+",
    re.I,
)
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")

TEXT_CAP = 280
ATTR_CAP = 24
BATCH_CAP = 40
GET_CAP = 400

_rate: dict[int, list[float]] = {}


def _user_key(user_id: int) -> str:
    return f"{settings.LIVE_TRACE_PREFIX}user:{int(user_id)}"


def _conv_key(user_id: int, conversation_id: str) -> str:
    return f"{settings.LIVE_TRACE_PREFIX}conv:{int(user_id)}:{conversation_id}"


def _call_key(user_id: int, call_id: str) -> str:
    return f"{settings.LIVE_TRACE_PREFIX}call:{int(user_id)}:{call_id}"


def _clip(value: Any, cap: int = TEXT_CAP) -> str:
    text = str(value or "")
    if not text:
        return ""
    if SECRET_VALUE.search(text):
        return "[redacted]"
    return text[: cap - 1] + "…" if len(text) > cap else text


def sanitize_event(raw: dict, user_id: int) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    if not NAME_RE.match(name):
        return None
    ts = str(raw.get("ts") or "").strip()
    if not ts:
        return None
    attrs_in = raw.get("attrs") if isinstance(raw.get("attrs"), dict) else {}
    attrs: dict[str, Any] = {}
    for key, value in list(attrs_in.items())[:ATTR_CAP]:
        if not key or SECRET_KEY.search(str(key)):
            continue
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            attrs[str(key)[:40]] = value
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            attrs[str(key)[:40]] = value
        else:
            attrs[str(key)[:40]] = _clip(value)
    conversation_id = str(raw.get("conversation_id") or "").strip()
    if conversation_id and not (UUID_RE.match(conversation_id) or ID_RE.match(conversation_id)):
        conversation_id = ""
    call_id = str(raw.get("call_id") or "").strip()
    if call_id and not ID_RE.match(call_id):
        call_id = ""
    trace_id = str(raw.get("trace_id") or "").strip()
    if trace_id and not ID_RE.match(trace_id):
        trace_id = ""
    session_id = str(raw.get("session_id") or "").strip()
    if session_id and not ID_RE.match(session_id):
        session_id = ""
    return {
        "name": name,
        "ts": ts,
        "seq": int(raw.get("seq") or 0),
        "session_id": session_id,
        "call_id": call_id,
        "trace_id": trace_id,
        "conversation_id": conversation_id,
        "user_id": int(user_id),
        "agent": _clip(raw.get("agent") or "", 40),
        "route": _clip(raw.get("route") or "", 120),
        "attrs": attrs,
        "source": "browser",
    }


def check_rate(user_id: int) -> None:
    now = time.monotonic()
    window = now - 60
    recent = [ts for ts in _rate.get(user_id, []) if ts >= window]
    if len(recent) >= settings.LIVE_TRACE_RATE_PER_MINUTE:
        _rate[user_id] = recent
        raise RateLimited()
    recent.append(now)
    _rate[user_id] = recent


def clear_rate_for_tests() -> None:
    _rate.clear()


class RateLimited(Exception):
    pass


async def persist_events(user_id: int, events: list[dict]) -> int:
    if not events:
        return 0
    r = await get_redis()
    stored = 0
    for event in events:
        payload = json.dumps(event, separators=(",", ":"), default=str)
        fields = {"event": payload}
        await r.xadd(
            _user_key(user_id),
            fields,
            maxlen=settings.LIVE_TRACE_MAXLEN,
            approximate=True,
        )
        if event.get("conversation_id"):
            await r.xadd(
                _conv_key(user_id, event["conversation_id"]),
                fields,
                maxlen=settings.LIVE_TRACE_MAXLEN,
                approximate=True,
            )
        if event.get("call_id"):
            await r.xadd(
                _call_key(user_id, event["call_id"]),
                fields,
                maxlen=min(2000, settings.LIVE_TRACE_MAXLEN),
                approximate=True,
            )
        stored += 1
        logger.info(
            "live_trace %s",
            json.dumps(
                {
                    "name": event.get("name"),
                    "user_id": user_id,
                    "call_id": event.get("call_id") or "",
                    "trace_id": event.get("trace_id") or "",
                    "conversation_id": event.get("conversation_id") or "",
                    "ts": event.get("ts"),
                },
                separators=(",", ":"),
            ),
        )
    await r.expire(_user_key(user_id), settings.LIVE_TRACE_TTL_SECONDS)
    return stored


def _parse(stream_id: str, data: dict, user_id: int) -> Optional[dict]:
    raw = data.get("event") or data.get("data")
    if not raw:
        return None
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (TypeError, ValueError):
        return None
    if int(parsed.get("user_id") or 0) != int(user_id):
        return None
    parsed["id"] = stream_id
    return parsed


async def read_events(
    user_id: int,
    *,
    conversation_id: str = "",
    call_id: str = "",
    limit: int = 200,
) -> list[dict]:
    r = await get_redis()
    if call_id and ID_RE.match(call_id):
        key = _call_key(user_id, call_id)
    elif conversation_id and (UUID_RE.match(conversation_id) or ID_RE.match(conversation_id)):
        key = _conv_key(user_id, conversation_id)
    else:
        key = _user_key(user_id)
    try:
        rows = await r.xrevrange(key, max="+", min="-", count=max(1, min(limit, GET_CAP)))
    except aioredis.RedisError as exc:
        logger.warning("live_trace read failed: %s", exc)
        return []
    events = []
    for stream_id, data in reversed(list(rows or [])):
        parsed = _parse(stream_id, data, user_id)
        if parsed:
            events.append(parsed)
    return events


async def fetch_connect_messages(
    bearer: str,
    conversation_id: str,
    limit: int = 80,
) -> list[dict]:
    if not conversation_id or not (UUID_RE.match(conversation_id) or ID_RE.match(conversation_id)):
        return []
    url = f"{settings.CONNECT_API_URL.rstrip('/')}/conversations/{conversation_id}/messages/"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(
                url,
                headers={"Authorization": f"Bearer {bearer}"},
                params={"page_size": str(min(limit, 100))},
            )
        if res.status_code >= 400:
            return []
        body = res.json()
    except Exception as exc:
        logger.warning("live_trace connect join failed: %s", exc)
        return []
    rows = body.get("results") if isinstance(body, dict) else body
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows[-limit:]:
        if not isinstance(row, dict):
            continue
        created = row.get("created_at") or row.get("timestamp") or row.get("sent_at") or ""
        out.append({
            "name": "connect.message",
            "ts": str(created),
            "source": "connect",
            "conversation_id": conversation_id,
            "user_id": row.get("sender_id"),
            "attrs": {
                "message_id": str(row.get("id") or row.get("client_message_id") or ""),
                "sender_id": row.get("sender_id"),
                "sender": _clip(row.get("sender_name") or row.get("sender") or "", 40),
                "text": _clip(row.get("content") or row.get("text") or "", 220),
            },
        })
    return out


def merge_timeline(browser: list[dict], messages: list[dict]) -> list[dict]:
    combined = list(browser) + list(messages)
    combined.sort(key=lambda e: (str(e.get("ts") or ""), int(e.get("seq") or 0), str(e.get("id") or "")))
    return combined
