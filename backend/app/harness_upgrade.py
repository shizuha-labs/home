"""HIVE-615 Automatic fleet-wide harness upgrades — detect → build → canary → roll → auto-rollback.

A scheduled job (and a manual staff trigger) that polls for new harness releases,
dispatches a multi-arch rebuild, canaries on one non-critical agent, rolls the
fleet, and auto-rolls-back on failure. Every stage calls the REAL Hive fleet
control API (no stubs):

  * build   → POST {HIVE}/v1/fleet/harness-versions/{harness}/upgrade/  (dispatches
              the Origin CI build-agent-runtime workflow; returns the expected image)
  * canary  → POST {HIVE}/v1/fleet/agents/{id}/switch-backend/ {image}  (pins ONE
              agent to the new image + rolling restart), then poll its health
  * roll    → POST {HIVE}/v1/fleet/runtime-image {image}  (Hive-owned desired image;
              the daemon's idle-gated roller converges the fleet one agent at a time)
  * verify  → GET  {HIVE}/v1/fleet/agents/  (agents healthy + producing turns)
  * rollback→ re-POST runtime-image / switch-backend with the last-good image

Auth: the manual trigger uses the staff CALLER's bearer; the scheduled (callerless)
path uses settings.HIVE_SERVICE_TOKEN. If neither is present the scheduler runs
NOTIFY-ONLY (detect + record, never roll) — it never silently claims a live change.

Config flag HARNESS_AUTOUPGRADE (env): off | patch | minor | major (default: patch)

HLD: https://wiki.shizuha.com/9e59bd34-941c-4c23-b4a5-2adbc333b5d2
"""
import asyncio
import datetime
import json
import logging
import time
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional

import httpx

from .config import settings

logger = logging.getLogger("home_bff.harness_upgrade")

# ── Config ────────────────────────────────────────────────────────────────────

class AutoUpgradeLevel(str, Enum):
    off = "off"
    patch = "patch"
    minor = "minor"
    major = "major"


def _parse_level(raw: str) -> AutoUpgradeLevel:
    """Tolerant parse of HARNESS_AUTOUPGRADE — an unknown value fails SAFE (off)."""
    try:
        return AutoUpgradeLevel((raw or "").strip().lower())
    except ValueError:
        logger.warning("Unknown HARNESS_AUTOUPGRADE=%r; defaulting to off", raw)
        return AutoUpgradeLevel.off


AUTOUPGRADE = _parse_level(settings.HARNESS_AUTOUPGRADE)
POLL_INTERVAL_SECONDS = settings.HARNESS_POLL_INTERVAL
CANARY_OBSERVATION_SECONDS = settings.HARNESS_CANARY_OBSERVATION
CANARY_AGENT_EMAIL = settings.HARNESS_CANARY_AGENT
CANARY_TIMEOUT_SECONDS = settings.HARNESS_CANARY_TIMEOUT
ROLL_TIMEOUT_SECONDS = settings.HARNESS_ROLL_TIMEOUT

_HIVE = settings.HIVE_API_URL
_HISTORY_KEY = "home:harness-upgrade:history"
_LAST_GOOD_KEY = "home:harness-upgrade:last-good"
_HISTORY_CAP = 100
# Health poll cadence while observing canary / fleet convergence.
_HEALTH_POLL_SECONDS = 15

# Known harnesses with their npm package names and OCI label keys.
HARNESSES = {
    "codex": {
        "npm": "@shizuha/codex",
        "oci_label": "org.shizuha.harness.codex",
        "dockerfile_var": "CODEX_VERSION",
    },
    "claude-code": {
        "npm": "@anthropic/claude-code",
        "oci_label": "org.shizuha.harness.claude-code",
        "dockerfile_var": "CLAUDE_CODE_VERSION",
    },
    "gemini": {
        "npm": "@google/gemini-cli",
        "oci_label": "org.shizuha.harness.gemini",
        "dockerfile_var": "GEMINI_VERSION",
    },
    "openclaw": {
        "npm": "@shizuha/openclaw",
        "oci_label": "org.shizuha.harness.openclaw",
        "dockerfile_var": "OPENCLAW_VERSION",
    },
}

# ── State (Redis-persisted; survives a process restart so the pipeline knows the
#    last-good image to roll back to — reika P2) ─────────────────────────────────

@dataclass
class UpgradeRun:
    id: str
    timestamp: str
    harness: str
    from_version: str
    to_version: str
    status: str  # detected → building → canarying → rolling → verifying → completed / rolled_back / skipped
    canary_agent: Optional[str] = None
    canary_result: Optional[str] = None
    rollback_reason: Optional[str] = None
    image_tag: Optional[str] = None


# Best-effort in-process mirror so status reads work even during a Redis brownout.
# Redis is the source of truth; this is only a fallback cache.
_history_cache: list[dict] = []
_last_good_cache: Optional[str] = None


async def _redis():
    """Return an async Redis handle, or None if unavailable (fail-soft)."""
    try:
        from .redis_client import get_redis
        return await get_redis()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("harness-upgrade: Redis unavailable (%s); using in-memory state", exc)
        return None


async def _load_history() -> list[dict]:
    r = await _redis()
    if r is None:
        return list(_history_cache)
    try:
        raw = await r.get(_HISTORY_KEY)
        return json.loads(raw) if raw else []
    except Exception as exc:
        logger.warning("harness-upgrade: history load failed (%s)", exc)
        return list(_history_cache)


async def _save_run(run: UpgradeRun) -> None:
    """Upsert a run into the persisted history (keyed by run.id), capped."""
    global _history_cache
    hist = await _load_history()
    row = asdict(run)
    hist = [h for h in hist if h.get("id") != run.id]
    hist.append(row)
    hist = hist[-_HISTORY_CAP:]
    _history_cache = hist
    r = await _redis()
    if r is not None:
        try:
            await r.set(_HISTORY_KEY, json.dumps(hist))
        except Exception as exc:
            logger.warning("harness-upgrade: history save failed (%s)", exc)


async def _get_last_good() -> Optional[str]:
    global _last_good_cache
    r = await _redis()
    if r is None:
        return _last_good_cache
    try:
        val = await r.get(_LAST_GOOD_KEY)
        if isinstance(val, bytes):
            val = val.decode()
        _last_good_cache = val or _last_good_cache
        return val or None
    except Exception:
        return _last_good_cache


async def _set_last_good(image: str) -> None:
    global _last_good_cache
    _last_good_cache = image
    r = await _redis()
    if r is not None:
        try:
            await r.set(_LAST_GOOD_KEY, image)
        except Exception as exc:
            logger.warning("harness-upgrade: last-good save failed (%s)", exc)


# ── Semver gating ───────────────────────────────────────────────────────────────

def _semver_bump(current: str, target: str) -> str:
    """Return 'patch', 'minor', 'major', or 'unknown' for the bump level."""
    try:
        c_parts = [int(p) for p in current.lstrip("v").split(".")[:3]]
        t_parts = [int(p) for p in target.lstrip("v").split(".")[:3]]
    except (ValueError, IndexError, AttributeError):
        return "unknown"
    if len(t_parts) < 3 or len(c_parts) < 3:
        return "unknown"
    if t_parts[0] != c_parts[0]:
        return "major"
    if t_parts[1] != c_parts[1]:
        return "minor"
    if t_parts[2] != c_parts[2]:
        return "patch"
    return "unknown"  # same version


def _bump_allowed(current: str, target: str) -> bool:
    """Check if the bump level is allowed by AUTOUPGRADE config."""
    if AUTOUPGRADE == AutoUpgradeLevel.off:
        return False
    level = _semver_bump(current, target)
    if level == "unknown":
        return False
    order = {"patch": 1, "minor": 2, "major": 3}
    return order.get(level, 0) <= order.get(AUTOUPGRADE.value, 0)


# ── Hive fleet-control API ──────────────────────────────────────────────────────

def _bearer(explicit: Optional[str]) -> Optional[str]:
    """The staff bearer for control calls: the caller's (manual) or the configured
    Hive service token (scheduled). None ⇒ no credential ⇒ notify-only."""
    return explicit or (settings.HIVE_SERVICE_TOKEN or None)


async def _hive(method: str, path: str, bearer: Optional[str], *, json_body=None, timeout=30.0):
    """One Hive API call. Returns the httpx.Response, or None on transport error."""
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    url = f"{_HIVE}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient() as client:
            return await client.request(method, url, headers=headers, json=json_body, timeout=timeout)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("Hive %s %s failed: %s", method, path, exc)
        return None


async def _fleet_agents(bearer: Optional[str]) -> list[dict]:
    resp = await _hive("GET", "v1/fleet/agents/", bearer)
    if resp is None or resp.status_code != 200:
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    return data if isinstance(data, list) else data.get("results", data.get("agents", []))


def _agent_matches_canary(agent: dict) -> bool:
    target = CANARY_AGENT_EMAIL.strip().lower()
    local = target.split("@", 1)[0]
    for key in ("agent_username", "email", "owner_username", "display_name"):
        val = str(agent.get(key) or "").strip().lower()
        if val and val in (target, local):
            return True
    return False


def _agent_healthy(agent: dict) -> bool:
    """A canary/fleet agent is healthy when it is running, not asking for help, and
    its last heartbeat produced real work (no empty-turn/session-poison regression)."""
    status = str(agent.get("status") or "").lower()
    if status not in ("running", "active", "ready", "online"):
        return False
    if agent.get("needs_help"):
        return False
    outcome = str(agent.get("heartbeat_outcome") or "").lower()
    if outcome and outcome in ("empty_turn", "poisoned", "error", "failed"):
        return False
    return True


# ── Pipeline stages (real Hive calls) ───────────────────────────────────────────

async def trigger_build(harness: str, version: str, bearer: Optional[str]) -> Optional[str]:
    """Dispatch the Origin CI agent-runtime rebuild via Hive and return the expected
    image ref the fleet should converge to, or None if the build was not dispatched."""
    resp = await _hive("POST", f"v1/fleet/harness-versions/{harness}/upgrade/", bearer,
                        json_body={"target_version": version})
    if resp is None:
        return None
    if resp.status_code not in (200, 202):
        logger.error("BUILD dispatch rejected (%s): %s", resp.status_code, resp.text[:200])
        return None
    try:
        data = resp.json()
    except ValueError:
        return None
    if not data.get("auto_build"):
        logger.error("BUILD not auto-dispatched: %s", data.get("reason") or data.get("manual"))
        return None
    image = data.get("expected_image")
    logger.info("BUILD dispatched: harness=%s version=%s expected_image=%s", harness, version, image)
    return image


async def _poll_until(bearer: Optional[str], predicate, timeout_s: int, label: str) -> bool:
    """Poll the fleet until `predicate(agents)` is True or the timeout elapses."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        agents = await _fleet_agents(bearer)
        if agents and predicate(agents):
            return True
        await asyncio.sleep(_HEALTH_POLL_SECONDS)
    logger.warning("%s: not satisfied within %ds", label, timeout_s)
    return False


async def deploy_canary(image_tag: str, harness: str, bearer: Optional[str]) -> bool:
    """Pin ONE non-critical agent to the new image (rolling restart) and observe it
    stays healthy + producing turns through the observation window."""
    agents = await _fleet_agents(bearer)
    canary = next((a for a in agents if _agent_matches_canary(a)), None)
    if not canary:
        logger.error("CANARY: no agent matching %s found in the fleet", CANARY_AGENT_EMAIL)
        return False
    agent_id = canary.get("id") or canary.get("agent_id")
    resp = await _hive("POST", f"v1/fleet/agents/{agent_id}/switch-backend/", bearer,
                       json_body={"image": image_tag})
    if resp is None or resp.status_code not in (200, 202):
        logger.error("CANARY: switch-backend rejected (%s)", getattr(resp, "status_code", "transport"))
        return False
    logger.info("CANARY: %s pinned to %s; observing up to %ds", CANARY_AGENT_EMAIL, image_tag, CANARY_TIMEOUT_SECONDS)

    # First the agent must come back healthy on the new image (absorbs build+pull),
    def _canary_up(agents):
        a = next((x for x in agents if _agent_matches_canary(x)), None)
        return bool(a and _agent_healthy(a) and image_tag.rsplit(":", 1)[-1] in str(a.get("effective_image") or a.get("image") or ""))
    if not await _poll_until(bearer, _canary_up, CANARY_TIMEOUT_SECONDS, "CANARY up"):
        return False

    # …then it must STAY healthy across the observation window (catch session poison).
    stable_deadline = time.monotonic() + min(CANARY_OBSERVATION_SECONDS, CANARY_TIMEOUT_SECONDS)
    while time.monotonic() < stable_deadline:
        await asyncio.sleep(_HEALTH_POLL_SECONDS)
        agents = await _fleet_agents(bearer)
        a = next((x for x in agents if _agent_matches_canary(x)), None)
        if not a or not _agent_healthy(a):
            logger.error("CANARY: %s regressed during observation", CANARY_AGENT_EMAIL)
            return False
    return True


async def rollback_canary(bearer: Optional[str]) -> bool:
    """Revert the canary agent to the last-good image."""
    last_good = await _get_last_good()
    agents = await _fleet_agents(bearer)
    canary = next((a for a in agents if _agent_matches_canary(a)), None)
    if not canary:
        return False
    agent_id = canary.get("id") or canary.get("agent_id")
    if last_good:
        await _hive("POST", f"v1/fleet/agents/{agent_id}/switch-backend/", bearer, json_body={"image": last_good})
        logger.info("CANARY ROLLBACK: %s reverted to %s", CANARY_AGENT_EMAIL, last_good)
    else:
        # No pinned last-good known ⇒ clear the per-agent override so the agent falls
        # back to the fleet default image on its next reconcile.
        await _hive("POST", f"v1/fleet/agents/{agent_id}/switch-backend/", bearer, json_body={"image": ""})
        logger.info("CANARY ROLLBACK: %s override cleared (no last-good recorded)", CANARY_AGENT_EMAIL)
    return True


async def roll_fleet(image_tag: str, bearer: Optional[str]) -> bool:
    """Set the Hive-owned desired fleet runtime image; the daemon's idle-gated roller
    converges agents one at a time (sessions survive on the PVC)."""
    resp = await _hive("POST", "v1/fleet/runtime-image", bearer, json_body={"image": image_tag})
    if resp is None or resp.status_code not in (200, 202):
        logger.error("FLEET ROLL rejected (%s): %s", getattr(resp, "status_code", "transport"),
                     getattr(resp, "text", "")[:200])
        return False
    logger.info("FLEET ROLL: desired image set to %s", image_tag)
    return True


async def verify_fleet_health(image_tag: str, bearer: Optional[str]) -> bool:
    """Confirm the fleet converged onto the new image and agents are healthy +
    producing turns. Fails (→ rollback) if convergence stalls or agents regress."""
    tag = image_tag.rsplit(":", 1)[-1]

    def _converged(agents):
        managed = [a for a in agents if a.get("lifecycle_managed") and str(a.get("status") or "").lower() in ("running", "active", "ready", "online")]
        if not managed:
            return False
        on_new = [a for a in managed if tag in str(a.get("effective_image") or a.get("image") or "")]
        # Require a strong majority converged AND every converged agent healthy.
        return len(on_new) >= max(1, (len(managed) * 2) // 3) and all(_agent_healthy(a) for a in on_new)

    return await _poll_until(bearer, _converged, ROLL_TIMEOUT_SECONDS, "FLEET converge+health")


async def rollback_fleet(bearer: Optional[str]) -> bool:
    """Revert the fleet's desired image to the last-good one."""
    last_good = await _get_last_good()
    if not last_good:
        logger.error("FLEET ROLLBACK: no last-good image recorded — leaving desired image unset "
                     "so the daemon keeps its env pin")
        await _hive("POST", "v1/fleet/runtime-image", bearer, json_body={"image": ""})
        return True
    resp = await _hive("POST", "v1/fleet/runtime-image", bearer, json_body={"image": last_good})
    logger.info("FLEET ROLLBACK: desired image reverted to %s", last_good)
    return resp is not None and resp.status_code in (200, 202)


# ── Upgrade pipeline ──────────────────────────────────────────────────────────

async def run_upgrade_pipeline(upgrade: dict, bearer: Optional[str]) -> UpgradeRun:
    """Execute the full upgrade pipeline for one candidate.

    build → canary → roll → verify → record. On failure at any step: auto-rollback.
    Every status change is persisted so a restart can resume/audit.
    """
    run = UpgradeRun(
        id=f"upgrade-{upgrade['harness']}-{int(time.time())}",
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        harness=upgrade["harness"],
        from_version=upgrade["from"],
        to_version=upgrade["to"],
        status="detected",
    )
    await _save_run(run)
    logger.info("UPGRADE START: %s %s → %s", run.harness, run.from_version, run.to_version)

    # Notify-only when we have no staff credential to drive the roll.
    if bearer is None:
        run.status = "skipped"
        run.rollback_reason = "notify-only: no staff bearer (set HIVE_SERVICE_TOKEN for the scheduled path)"
        await _save_run(run)
        logger.warning("UPGRADE SKIPPED (notify-only): %s %s → %s", run.harness, run.from_version, run.to_version)
        return run

    # Record the fleet's current image as the rollback target BEFORE we change it.
    agents = await _fleet_agents(bearer)
    current_image = next((a.get("effective_image") for a in agents if a.get("effective_image")), None)
    if current_image:
        await _set_last_good(current_image)

    # Step 1: Build
    run.status = "building"
    await _save_run(run)
    image_tag = await trigger_build(upgrade["harness"], upgrade["to"], bearer)
    if not image_tag:
        run.status = "rolled_back"
        run.rollback_reason = "Build dispatch failed"
        await _save_run(run)
        logger.error("UPGRADE FAILED (build): %s", run.rollback_reason)
        return run
    run.image_tag = image_tag

    # Step 2: Canary
    run.status = "canarying"
    run.canary_agent = CANARY_AGENT_EMAIL
    await _save_run(run)
    if not await deploy_canary(image_tag, upgrade["harness"], bearer):
        run.status = "rolled_back"
        run.canary_result = "failed"
        run.rollback_reason = "Canary verification failed"
        await rollback_canary(bearer)
        await _save_run(run)
        logger.error("UPGRADE FAILED (canary): %s", run.rollback_reason)
        return run
    run.canary_result = "passed"

    # Step 3: Fleet roll
    run.status = "rolling"
    await _save_run(run)
    if not await roll_fleet(image_tag, bearer):
        run.status = "rolled_back"
        run.rollback_reason = "Fleet roll failed"
        await rollback_fleet(bearer)
        await rollback_canary(bearer)
        await _save_run(run)
        logger.error("UPGRADE FAILED (roll): %s", run.rollback_reason)
        return run

    # Step 4: Verify convergence + health
    run.status = "verifying"
    await _save_run(run)
    if not await verify_fleet_health(image_tag, bearer):
        run.status = "rolled_back"
        run.rollback_reason = "Post-roll verification failed"
        await rollback_fleet(bearer)
        await rollback_canary(bearer)
        await _save_run(run)
        logger.error("UPGRADE FAILED (verify): %s", run.rollback_reason)
        return run

    # Success — the new image becomes the last-good rollback target.
    await _set_last_good(image_tag)
    run.status = "completed"
    await _save_run(run)
    logger.info("UPGRADE COMPLETE: %s %s → %s (%s)", run.harness, run.from_version, run.to_version, image_tag)
    return run


# ── Detection ─────────────────────────────────────────────────────────────────

async def fetch_npm_latest(package: str) -> Optional[str]:
    """Fetch the latest version of an npm package from the registry."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://registry.npmjs.org/{package}/latest", timeout=10.0)
            if resp.status_code == 200:
                return resp.json().get("version")
    except (httpx.TimeoutException, httpx.TransportError, ValueError) as exc:
        logger.warning("npm fetch failed for %s: %s", package, exc)
    return None


async def detect_upgrades(current_versions: dict[str, str]) -> list[dict]:
    """Check each harness for available upgrades allowed by the AUTOUPGRADE policy."""
    upgrades = []
    for name, info in HARNESSES.items():
        current = current_versions.get(name)
        if not current:
            continue
        latest = await fetch_npm_latest(info["npm"])
        if not latest or latest == current:
            continue
        if not _bump_allowed(current, latest):
            logger.info("Upgrade %s %s→%s skipped (bump not allowed by AUTOUPGRADE=%s)",
                        name, current, latest, AUTOUPGRADE.value)
            continue
        upgrades.append({
            "harness": name, "from": current, "to": latest,
            "npm": info["npm"], "oci_label": info["oci_label"], "dockerfile_var": info["dockerfile_var"],
        })
    return upgrades


# ── Scheduler / entry points ────────────────────────────────────────────────────

async def poll_and_upgrade(current_versions: dict[str, str], bearer: Optional[str] = None) -> list[UpgradeRun]:
    """One poll cycle: detect allowed upgrades and run the pipeline for each.

    `bearer` is the staff caller's token (manual trigger). When omitted, the
    configured HIVE_SERVICE_TOKEN is used (scheduled path); if that too is empty
    the pipeline records each candidate as `skipped` (notify-only) rather than
    rolling without a credential.
    """
    upgrades = await detect_upgrades(current_versions)
    if not upgrades:
        logger.info("No upgrades available (AUTOUPGRADE=%s)", AUTOUPGRADE.value)
        return []
    creds = _bearer(bearer)
    results = []
    for upgrade in upgrades:
        results.append(await run_upgrade_pipeline(upgrade, creds))
    return results


# ── API helpers (async, Redis-backed) ────────────────────────────────────────────

async def get_upgrade_history(limit: int = 20) -> list[dict]:
    hist = await _load_history()
    return hist[-limit:]


async def get_upgrade_status() -> dict:
    hist = await _load_history()
    active = [h for h in hist if h.get("status") not in ("completed", "rolled_back", "skipped")]
    return {
        "autoupgrade_level": AUTOUPGRADE.value,
        "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        "auto_roll_enabled": bool(settings.HIVE_SERVICE_TOKEN) and AUTOUPGRADE != AutoUpgradeLevel.off,
        "active_upgrades": active,
        "recent_upgrades": hist[-5:],
        "last_good_image": await _get_last_good(),
    }
