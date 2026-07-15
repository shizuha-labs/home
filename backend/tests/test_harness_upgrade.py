"""HIVE-615 harness auto-upgrade pipeline tests.

Covers the pure gating/matcher logic, the detection filter, the pipeline state
machine (success + rollback at every stage + notify-only), and Redis-backed
persistence — no live Hive/npm calls (all mocked)."""
import asyncio
import os

os.environ.setdefault("SHIZUHA_JWKS_URL", "https://id.test/.well-known/jwks.json")

import pytest

from app import harness_upgrade as hu
from app.harness_upgrade import AutoUpgradeLevel, UpgradeRun


def _run(coro):
    return asyncio.run(coro)


# ── semver gating ───────────────────────────────────────────────────────────────

def test_semver_bump_levels():
    assert hu._semver_bump("1.2.3", "1.2.4") == "patch"
    assert hu._semver_bump("1.2.3", "1.3.0") == "minor"
    assert hu._semver_bump("1.2.3", "2.0.0") == "major"
    assert hu._semver_bump("1.2.3", "1.2.3") == "unknown"   # same version
    assert hu._semver_bump("1.2.3", "1.2") == "unknown"     # unequal length
    assert hu._semver_bump("nope", "1.2.3") == "unknown"    # non-numeric
    assert hu._semver_bump("v1.2.3", "v1.2.4") == "patch"   # v-prefix tolerated


def test_bump_allowed_respects_level(monkeypatch):
    monkeypatch.setattr(hu, "AUTOUPGRADE", AutoUpgradeLevel.patch)
    assert hu._bump_allowed("1.2.3", "1.2.4") is True      # patch under patch
    assert hu._bump_allowed("1.2.3", "1.3.0") is False     # minor over patch cap

    monkeypatch.setattr(hu, "AUTOUPGRADE", AutoUpgradeLevel.minor)
    assert hu._bump_allowed("1.2.3", "1.3.0") is True
    assert hu._bump_allowed("1.2.3", "2.0.0") is False     # major over minor cap

    monkeypatch.setattr(hu, "AUTOUPGRADE", AutoUpgradeLevel.off)
    assert hu._bump_allowed("1.2.3", "1.2.4") is False     # off blocks everything


def test_parse_level_unknown_fails_safe():
    assert hu._parse_level("garbage") == AutoUpgradeLevel.off
    assert hu._parse_level("") == AutoUpgradeLevel.off
    assert hu._parse_level("MINOR") == AutoUpgradeLevel.minor


# ── health + canary matchers ─────────────────────────────────────────────────────

def test_agent_healthy():
    assert hu._agent_healthy({"status": "running", "needs_help": False, "heartbeat_outcome": "ok"})
    assert not hu._agent_healthy({"status": "provisioning"})
    assert not hu._agent_healthy({"status": "running", "needs_help": True})
    assert not hu._agent_healthy({"status": "running", "heartbeat_outcome": "empty_turn"})


def test_agent_matches_canary(monkeypatch):
    monkeypatch.setattr(hu, "CANARY_AGENT_EMAIL", "test@shizuha.com")
    assert hu._agent_matches_canary({"agent_username": "test"})
    assert hu._agent_matches_canary({"email": "test@shizuha.com"})
    assert not hu._agent_matches_canary({"agent_username": "ryo"})


# ── detection filter ─────────────────────────────────────────────────────────────

def test_detect_upgrades_filters_by_policy(monkeypatch):
    monkeypatch.setattr(hu, "AUTOUPGRADE", AutoUpgradeLevel.patch)

    async def fake_latest(pkg):
        return {"@shizuha/codex": "1.0.1", "@anthropic/claude-code": "2.0.0"}.get(pkg)

    monkeypatch.setattr(hu, "fetch_npm_latest", fake_latest)
    ups = _run(hu.detect_upgrades({"codex": "1.0.0", "claude-code": "1.5.0"}))
    names = {u["harness"] for u in ups}
    assert "codex" in names            # 1.0.0→1.0.1 patch allowed
    assert "claude-code" not in names  # 1.5.0→2.0.0 major blocked under patch


# ── Redis-backed persistence (fake redis) ────────────────────────────────────────

class _FakeRedis:
    def __init__(self):
        self.kv = {}

    async def get(self, k):
        return self.kv.get(k)

    async def set(self, k, v):
        self.kv[k] = v


def test_history_and_last_good_persist(monkeypatch):
    fake = _FakeRedis()

    async def _fake_redis():
        return fake

    monkeypatch.setattr(hu, "_redis", _fake_redis)
    run = UpgradeRun(id="u1", timestamp="t", harness="codex", from_version="1.0.0",
                     to_version="1.0.1", status="building")
    _run(hu._save_run(run))
    run.status = "completed"
    _run(hu._save_run(run))            # upsert by id, not duplicate
    hist = _run(hu._load_history())
    assert len(hist) == 1 and hist[0]["status"] == "completed"

    _run(hu._set_last_good("shizuha-agent-runtime:hcodex-1-0-1"))
    assert _run(hu._get_last_good()) == "shizuha-agent-runtime:hcodex-1-0-1"


def test_persistence_falls_back_to_memory_when_redis_down(monkeypatch):
    async def _no_redis():
        return None

    monkeypatch.setattr(hu, "_redis", _no_redis)
    monkeypatch.setattr(hu, "_history_cache", [])
    run = UpgradeRun(id="u9", timestamp="t", harness="codex", from_version="1.0.0",
                     to_version="1.0.1", status="detected")
    _run(hu._save_run(run))
    assert any(h["id"] == "u9" for h in _run(hu._load_history()))


# ── pipeline state machine ───────────────────────────────────────────────────────

def _patch_pipeline(monkeypatch, **overrides):
    """Neutralise persistence + fleet reads; caller overrides the stage functions."""
    async def _noop(*a, **k):
        return None

    async def _agents(*a, **k):
        return [{"effective_image": "shizuha-agent-runtime:hcodex-1-0-0"}]

    monkeypatch.setattr(hu, "_save_run", _noop)
    monkeypatch.setattr(hu, "_set_last_good", _noop)
    monkeypatch.setattr(hu, "_fleet_agents", _agents)
    for name, fn in overrides.items():
        monkeypatch.setattr(hu, name, fn)


_UP = {"harness": "codex", "from": "1.0.0", "to": "1.0.1"}


def test_pipeline_success(monkeypatch):
    async def build(h, v, b):
        return "img:new"

    async def ok(*a, **k):
        return True

    _patch_pipeline(monkeypatch, trigger_build=build, deploy_canary=ok,
                    roll_fleet=ok, verify_fleet_health=ok)
    run = _run(hu.run_upgrade_pipeline(_UP, bearer="staff-tok"))
    assert run.status == "completed" and run.image_tag == "img:new"
    assert run.canary_result == "passed"


def test_pipeline_notify_only_without_bearer(monkeypatch):
    _patch_pipeline(monkeypatch)
    run = _run(hu.run_upgrade_pipeline(_UP, bearer=None))
    assert run.status == "skipped" and "notify-only" in run.rollback_reason


def test_pipeline_rolls_back_on_build_failure(monkeypatch):
    async def build(h, v, b):
        return None

    _patch_pipeline(monkeypatch, trigger_build=build)
    run = _run(hu.run_upgrade_pipeline(_UP, bearer="staff-tok"))
    assert run.status == "rolled_back" and "Build" in run.rollback_reason


def test_pipeline_rolls_back_on_canary_failure(monkeypatch):
    async def build(h, v, b):
        return "img:new"

    async def bad(*a, **k):
        return False

    calls = {"rollback_canary": 0}

    async def rb_canary(*a, **k):
        calls["rollback_canary"] += 1
        return True

    _patch_pipeline(monkeypatch, trigger_build=build, deploy_canary=bad, rollback_canary=rb_canary)
    run = _run(hu.run_upgrade_pipeline(_UP, bearer="staff-tok"))
    assert run.status == "rolled_back" and run.canary_result == "failed"
    assert calls["rollback_canary"] == 1


def test_pipeline_rolls_back_on_verify_failure(monkeypatch):
    async def build(h, v, b):
        return "img:new"

    async def ok(*a, **k):
        return True

    async def bad(*a, **k):
        return False

    fleet_rollbacks = {"n": 0}

    async def rb_fleet(*a, **k):
        fleet_rollbacks["n"] += 1
        return True

    _patch_pipeline(monkeypatch, trigger_build=build, deploy_canary=ok, roll_fleet=ok,
                    verify_fleet_health=bad, rollback_fleet=rb_fleet, rollback_canary=ok)
    run = _run(hu.run_upgrade_pipeline(_UP, bearer="staff-tok"))
    assert run.status == "rolled_back" and "verification" in run.rollback_reason.lower()
    assert fleet_rollbacks["n"] == 1
