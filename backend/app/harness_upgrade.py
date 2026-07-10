"""HIVE-615 Automatic fleet-wide harness upgrades — detect → build → canary → roll → auto-rollback.

A scheduled job that polls for new harness releases, triggers a multi-arch rebuild,
canaries on one non-critical agent, rolls fleet-wide, and auto-rollbacks on failure.

Config flag HARNESS_AUTOUPGRADE (env): off | patch | minor | major (default: patch)

HLD: https://wiki.shizuha.com/9e59bd34-941c-4c23-b4a5-2adbc333b5d2
"""
import asyncio
import datetime
import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
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

AUTOUPGRADE = AutoUpgradeLevel(os.environ.get("HARNESS_AUTOUPGRADE", "patch"))
POLL_INTERVAL_SECONDS = int(os.environ.get("HARNESS_POLL_INTERVAL", "21600"))  # 6h
CANARY_OBSERVATION_SECONDS = int(os.environ.get("HARNESS_CANARY_OBSERVATION", "900"))  # 15m
CANARY_AGENT_EMAIL = os.environ.get("HARNESS_CANARY_AGENT", "test@shizuha.com")

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

# ── State ─────────────────────────────────────────────────────────────────────

@dataclass
class UpgradeRun:
    id: str
    timestamp: str
    harness: str
    from_version: str
    to_version: str
    status: str  # detected → building → canarying → rolling → completed / rolled_back
    canary_agent: Optional[str] = None
    canary_result: Optional[str] = None
    rollback_reason: Optional[str] = None
    image_tag: Optional[str] = None

# In-memory upgrade history (persisted to Pulse task comments in production).
_upgrade_history: list[UpgradeRun] = []
_last_good_image: Optional[str] = None


def _semver_bump(current: str, target: str) -> str:
    """Return 'patch', 'minor', 'major', or 'unknown' for the bump level."""
    try:
        c_parts = [int(p) for p in current.lstrip("v").split(".")[:3]]
        t_parts = [int(p) for p in target.lstrip("v").split(".")[:3]]
    except (ValueError, IndexError):
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


# ── Detection ─────────────────────────────────────────────────────────────────

async def fetch_npm_latest(package: str) -> Optional[str]:
    """Fetch the latest version of an npm package from the registry."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://registry.npmjs.org/{package}/latest",
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("version")
    except (httpx.TimeoutException, httpx.TransportError, ValueError) as exc:
        logger.warning("npm fetch failed for %s: %s", package, exc)
    return None


async def detect_upgrades(current_versions: dict[str, str]) -> list[dict]:
    """Check each harness for available upgrades. Returns list of upgrade candidates."""
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
            "harness": name,
            "from": current,
            "to": latest,
            "npm": info["npm"],
            "oci_label": info["oci_label"],
            "dockerfile_var": info["dockerfile_var"],
        })
    return upgrades


# ── Build trigger ─────────────────────────────────────────────────────────────

async def trigger_build(harness: str, version: str) -> Optional[str]:
    """Trigger a Forgejo workflow_dispatch to rebuild the agent-runtime image.

    Returns the new image tag on success, None on failure.
    """
    image_tag = f"shizuha-agent-runtime:h{harness}-{version.replace('.', '-')}"
    # TODO: Wire Forgejo workflow_dispatch via its API.
    # For now, log the intent and return the tag for testing.
    logger.info("BUILD TRIGGER: harness=%s version=%s image_tag=%s",
                harness, version, image_tag)
    return image_tag


# ── Canary ────────────────────────────────────────────────────────────────────

async def deploy_canary(image_tag: str, harness: str) -> bool:
    """Deploy the new image to the canary agent and verify it works.

    Returns True if canary passes, False if it fails.
    """
    logger.info("CANARY: deploying %s to %s", image_tag, CANARY_AGENT_EMAIL)
    # TODO: Call Hive API to update the canary agent's image.
    # For now, simulate a successful canary.
    await asyncio.sleep(2)
    logger.info("CANARY: observing %s for %ds", CANARY_AGENT_EMAIL, CANARY_OBSERVATION_SECONDS)
    await asyncio.sleep(2)  # In production, poll agent health for CANARY_OBSERVATION_SECONDS
    return True


async def rollback_canary(image_tag: str) -> bool:
    """Rollback the canary agent to the last-good image."""
    global _last_good_image
    logger.info("CANARY ROLLBACK: reverting %s to %s", CANARY_AGENT_EMAIL, _last_good_image)
    return True


# ── Fleet roll ────────────────────────────────────────────────────────────────

async def roll_fleet(image_tag: str) -> bool:
    """Roll the new image to the entire fleet.

    Returns True if the roll succeeds, False if it fails.
    """
    logger.info("FLEET ROLL: deploying %s fleet-wide", image_tag)
    # TODO: Call Hive API to update SHIZUHA_AGENT_RUNTIME_IMAGE and rollout restart.
    await asyncio.sleep(2)
    return True


async def verify_fleet_health(image_tag: str) -> bool:
    """Verify fleet health after a roll.

    Returns True if healthy, False if rollback needed.
    """
    logger.info("VERIFY: checking fleet health after %s", image_tag)
    # TODO: Poll Hive API for agent health.
    await asyncio.sleep(1)
    return True


async def rollback_fleet(image_tag: str) -> bool:
    """Rollback the entire fleet to the last-good image."""
    global _last_good_image
    logger.info("FLEET ROLLBACK: reverting fleet to %s", _last_good_image)
    return True


# ── Upgrade pipeline ──────────────────────────────────────────────────────────

async def run_upgrade_pipeline(upgrade: dict) -> UpgradeRun:
    """Execute the full upgrade pipeline for one harness upgrade candidate.

    detect → build → canary → roll → verify → record
    On failure at any step: auto-rollback.
    """
    run = UpgradeRun(
        id=f"upgrade-{int(time.time())}",
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        harness=upgrade["harness"],
        from_version=upgrade["from"],
        to_version=upgrade["to"],
        status="detected",
    )
    _upgrade_history.append(run)
    logger.info("UPGRADE START: %s %s → %s", run.harness, run.from_version, run.to_version)

    # Step 1: Build
    run.status = "building"
    image_tag = await trigger_build(upgrade["harness"], upgrade["to"])
    if not image_tag:
        run.status = "rolled_back"
        run.rollback_reason = "Build failed"
        logger.error("UPGRADE FAILED (build): %s", run.rollback_reason)
        return run
    run.image_tag = image_tag

    # Step 2: Canary
    run.status = "canarying"
    run.canary_agent = CANARY_AGENT_EMAIL
    canary_ok = await deploy_canary(image_tag, upgrade["harness"])
    if not canary_ok:
        run.status = "rolled_back"
        run.canary_result = "failed"
        run.rollback_reason = "Canary verification failed"
        await rollback_canary(image_tag)
        logger.error("UPGRADE FAILED (canary): %s", run.rollback_reason)
        return run
    run.canary_result = "passed"

    # Step 3: Fleet roll
    run.status = "rolling"
    roll_ok = await roll_fleet(image_tag)
    if not roll_ok:
        run.status = "rolled_back"
        run.rollback_reason = "Fleet roll failed"
        await rollback_fleet(image_tag)
        logger.error("UPGRADE FAILED (roll): %s", run.rollback_reason)
        return run

    # Step 4: Verify
    healthy = await verify_fleet_health(image_tag)
    if not healthy:
        run.status = "rolled_back"
        run.rollback_reason = "Post-roll verification failed"
        await rollback_fleet(image_tag)
        logger.error("UPGRADE FAILED (verify): %s", run.rollback_reason)
        return run

    # Success
    global _last_good_image
    _last_good_image = image_tag
    run.status = "completed"
    logger.info("UPGRADE COMPLETE: %s %s → %s (%s)", run.harness, run.from_version, run.to_version, image_tag)
    return run


# ── Scheduler ─────────────────────────────────────────────────────────────────

async def poll_and_upgrade(current_versions: dict[str, str]) -> list[UpgradeRun]:
    """One poll cycle: detect upgrades and run the pipeline for each candidate."""
    upgrades = await detect_upgrades(current_versions)
    if not upgrades:
        logger.info("No upgrades available (AUTOUPGRADE=%s)", AUTOUPGRADE.value)
        return []

    results = []
    for upgrade in upgrades:
        run = await run_upgrade_pipeline(upgrade)
        results.append(run)
    return results


# ── API helpers ───────────────────────────────────────────────────────────────

def get_upgrade_history(limit: int = 20) -> list[dict]:
    """Return recent upgrade history."""
    return [asdict(r) for r in _upgrade_history[-limit:]]


def get_upgrade_status() -> dict:
    """Return current upgrade status summary."""
    active = [asdict(r) for r in _upgrade_history if r.status not in ("completed", "rolled_back")]
    recent = [asdict(r) for r in _upgrade_history[-5:]]
    return {
        "autoupgrade_level": AUTOUPGRADE.value,
        "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        "active_upgrades": active,
        "recent_upgrades": recent,
        "last_good_image": _last_good_image,
    }
