#!/usr/bin/env python3
"""HIVE-652 live disjoint-tenant probe for the deployed Home BFF.

Required environment:
  HOME_TOKEN_A / HOME_TOKEN_B  live RS256 ID tokens with disjoint memberships
  HOME_PROBE_REDIS_URL         Redis used by the deployed Home activity reader

Optional:
  HOME_BASE_URL                defaults to https://shizuha.com
  HOME_ACTIVITY_STREAM_PREFIX  defaults to home:activity:v1:org:
  HOME_LIVE_IMAGE              exact deployed image recorded in evidence

The probe uses one uniquely named, preflight-empty synthetic stream per org and
deletes both in ``finally``. It refuses overlapping memberships or pre-existing
keys so cleanup can never destroy another probe/tenant's data. Bearers are never
printed.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

import redis


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable {name}")
    return value


def _claims(token: str) -> dict:
    try:
        payload = token.split(".", 2)[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception as exc:
        raise RuntimeError("token is not a decodable JWT") from exc


def _memberships(token: str) -> set[int]:
    raw = _claims(token).get("organization_memberships") or {}
    if not isinstance(raw, dict):
        return set()
    result = set()
    for value in raw:
        try:
            result.add(int(value))
        except (TypeError, ValueError):
            pass
    return result


def _request(base: str, path: str, token: str, extra_headers=None) -> tuple[int, object]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    headers.update(extra_headers or {})
    request = urllib.request.Request(f"{base}{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"body": body.decode("utf-8", "replace")[:200]}
        return exc.code, payload


def _path(endpoint: str, org_id: int) -> str:
    return f"{endpoint}?{urllib.parse.urlencode({'org_id': org_id})}"


def _event(org_id: int, marker: str) -> str:
    return json.dumps({
        "version": 1,
        "id": "0-0",
        "source": "pulse",
        "type": "task.transition",
        "occurred_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "org_id": org_id,
        "summary": marker,
        "actor": {"kind": "system"},
        "target": {"kind": "task", "key": "HIVE-652"},
        "redaction": "none",
        "priority": "normal",
        "metadata": {"probe": "HIVE-652"},
    }, separators=(",", ":"))


def _expect_status(base: str, endpoint: str, token: str, org_id: int, expected: int) -> object:
    status, payload = _request(base, _path(endpoint, org_id), token)
    if status != expected:
        raise AssertionError(f"{endpoint} org={org_id}: expected {expected}, got {status}")
    return payload


def main() -> int:
    base = os.environ.get("HOME_BASE_URL", "https://shizuha.com").rstrip("/")
    token_a, token_b = _required("HOME_TOKEN_A"), _required("HOME_TOKEN_B")
    orgs_a, orgs_b = _memberships(token_a), _memberships(token_b)
    if len(orgs_a) != 1 or len(orgs_b) != 1 or orgs_a & orgs_b:
        raise RuntimeError(
            "probe tokens must each have exactly one, disjoint organization membership"
        )
    org_a, org_b = next(iter(orgs_a)), next(iter(orgs_b))
    prefix = os.environ.get("HOME_ACTIVITY_STREAM_PREFIX", "home:activity:v1:org:")
    key_a, key_b = f"{prefix}{org_a}", f"{prefix}{org_b}"
    redis_client = redis.Redis.from_url(_required("HOME_PROBE_REDIS_URL"), decode_responses=True)
    preexisting = {key: int(redis_client.exists(key)) for key in (key_a, key_b)}
    if any(preexisting.values()):
        raise RuntimeError(f"refusing non-empty probe stream keys: {preexisting}")

    nonce = uuid.uuid4().hex
    marker_a, marker_b = f"HIVE-652-A-{nonce}", f"HIVE-652-B-{nonce}"
    cleanup_deleted = 0
    try:
        redis_client.xadd(key_a, {"event": _event(org_a, marker_a)}, maxlen=10)
        redis_client.xadd(key_b, {"event": _event(org_b, marker_b)}, maxlen=10)

        summary_a = _expect_status(base, "/api/home/summary", token_a, org_a, 200)
        summary_b = _expect_status(base, "/api/home/summary", token_b, org_b, 200)
        if summary_a.get("org_id") != org_a or summary_b.get("org_id") != org_b:
            raise AssertionError("selected summary envelope mislabeled")
        if {o.get("id") for o in summary_a.get("orgs", [])} != {org_a}:
            raise AssertionError("actor A summary widened beyond signed memberships")
        if {o.get("id") for o in summary_b.get("orgs", [])} != {org_b}:
            raise AssertionError("actor B summary widened beyond signed memberships")

        # Client-selected org headers are not an authorization source.
        status, header_scoped = _request(
            base,
            _path("/api/home/summary", org_a),
            token_a,
            {"X-Organization-ID": str(org_b), "X-Org-ID": str(org_b)},
        )
        if status != 200 or header_scoped.get("org_id") != org_a:
            raise AssertionError("foreign organization header widened/changed selected scope")

        endpoints = (
            "/api/home/summary",
            "/api/home/activity",
            "/api/home/activity/recent",
            "/api/home/activity/stream",
        )
        for endpoint in endpoints:
            _expect_status(base, endpoint, token_a, org_b, 403)
            _expect_status(base, endpoint, token_b, org_a, 403)

        recent_a = _expect_status(base, "/api/home/activity/recent", token_a, org_a, 200)
        recent_b = _expect_status(base, "/api/home/activity/recent", token_b, org_b, 200)
        encoded_a, encoded_b = json.dumps(recent_a), json.dumps(recent_b)
        if marker_a not in encoded_a or marker_b in encoded_a:
            raise AssertionError("actor A recent stream marker isolation failed")
        if marker_b not in encoded_b or marker_a in encoded_b:
            raise AssertionError("actor B recent stream marker isolation failed")

        for token, own_marker, foreign_marker in (
            (token_a, marker_a, marker_b),
            (token_b, marker_b, marker_a),
        ):
            status, aggregate = _request(base, "/api/home/activity/recent", token)
            encoded = json.dumps(aggregate)
            if status != 200 or own_marker not in encoded or foreign_marker in encoded:
                raise AssertionError("aggregate recent stream widened beyond signed memberships")

        evidence = {
            "probe": "HIVE-652",
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "base_url": base,
            "live_image": os.environ.get("HOME_LIVE_IMAGE", "unknown"),
            "org_a": org_a,
            "org_b": org_b,
            "marker_a_sha256": hashlib.sha256(marker_a.encode()).hexdigest(),
            "marker_b_sha256": hashlib.sha256(marker_b.encode()).hexdigest(),
            "foreign_endpoint_status": 403,
            "own_endpoint_status": 200,
        }
    finally:
        cleanup_deleted = int(redis_client.delete(key_a, key_b))
        remaining = {key: int(redis_client.exists(key)) for key in (key_a, key_b)}
        redis_client.close()
        if any(remaining.values()):
            raise RuntimeError(f"probe cleanup failed: {remaining}")

    evidence["cleanup_deleted_keys"] = cleanup_deleted
    evidence["cleanup_remaining_keys"] = 0
    print(json.dumps(evidence, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"HIVE-652_PROBE_FAILED: {exc}", file=sys.stderr)
        raise
