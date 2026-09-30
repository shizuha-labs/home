"""VEN-165 v23 regression evidence against a real Postgres connection.

Set BOOKS_COMPLIANCE_TEST_DATABASE_URL; CI creates the isolated database. The
fixture mirrors production order: token -> bounded beacon -> submit/finalize.
"""
from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("BOOKS_COMPLIANCE_PUBLIC_INTAKE_ENABLED", "true")
os.environ.setdefault("BOOKS_COMPLIANCE_DATABASE_URL", os.environ.get("BOOKS_COMPLIANCE_TEST_DATABASE_URL", ""))
os.environ.setdefault("BOOKS_COMPLIANCE_DESTINATION_HMAC_KEY", "destination-test-key-do-not-use")
os.environ.setdefault("BOOKS_COMPLIANCE_SUBMISSION_HMAC_KEY", "submission-test-key-do-not-use")
os.environ.setdefault("BOOKS_COMPLIANCE_ABUSE_HMAC_KEY", "abuse-test-key-do-not-use")
os.environ.setdefault("BOOKS_COMPLIANCE_ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("BOOKS_COMPLIANCE_FAKE_PROVIDER_ENABLED", "true")

from app.books_compliance import (  # noqa: E402
    BeaconRequest,
    IntakeRequest,
    RecoveryRequest,
    _create_or_coalesce_challenge,
    _digest,
    _finalize_locked,
    _now,
    database_url,
    db,
    ensure_schema,
    request_recovery,
    safe_csv,
    safe_html,
    submit_intake,
)
from app.main import app  # noqa: E402

pytestmark = pytest.mark.skipif(not database_url(), reason="real Postgres URL not configured")
TABLES = [
    "books_compliance_fake_outbox", "books_compliance_rights_request",
    "books_compliance_recovery_session", "books_compliance_challenge",
    "books_compliance_consent_evidence", "books_compliance_pending_lead",
    "books_compliance_funnel_aggregate", "books_compliance_funnel_token",
    "books_compliance_abuse_bucket",
    "books_compliance_provider_capacity_bucket",
]


@pytest.fixture(autouse=True)
def clean_store(monkeypatch):
    monkeypatch.setenv("BOOKS_COMPLIANCE_PUBLIC_INTAKE_ENABLED", "true")
    ensure_schema()
    with psycopg.connect(database_url()) as conn:
        conn.execute("TRUNCATE " + ",".join(TABLES) + " CASCADE")
    yield
    with psycopg.connect(database_url()) as conn:
        conn.execute("TRUNCATE " + ",".join(TABLES) + " CASCADE")


def counts():
    with db() as conn:
        return {
            "tokens": conn.execute("SELECT count(*) n FROM books_compliance_funnel_token").fetchone()["n"],
            "leads": conn.execute("SELECT count(*) n FROM books_compliance_pending_lead").fetchone()["n"],
            "consents": conn.execute("SELECT count(*) n FROM books_compliance_consent_evidence").fetchone()["n"],
            "aggregates": conn.execute("SELECT coalesce(sum(submit_count+expiry_count),0) n FROM books_compliance_funnel_aggregate").fetchone()["n"],
            "challenges": conn.execute("SELECT count(*) n FROM books_compliance_challenge").fetchone()["n"],
            "outbox": conn.execute("SELECT count(*) n FROM books_compliance_fake_outbox").fetchone()["n"],
        }


def issue(client: TestClient) -> str:
    response = client.post("/api/books/compliance/token", json={}, headers={"Origin": "http://testserver"})
    assert response.status_code == 201
    token = response.json()["token"]
    assert token not in repr(response.headers)
    return token


def intake(token: str, nonce: str = "nonce-0123456789-abcd") -> IntakeRequest:
    return IntakeRequest(
        token=token, client_nonce=nonce, name="Synthetic Operator", email="demo@example.test",
        company="Northstar Components Demo", phone=None, use_cases=["gst_tracking"],
        org_size="1-10", consent=True, source="direct",
    )


class RequestStub:
    class Client:
        host = "192.0.2.10"
    client = Client()


def test_disabled_gate_performs_zero_writes(monkeypatch):
    monkeypatch.setenv("BOOKS_COMPLIANCE_PUBLIC_INTAKE_ENABLED", "false")
    client = TestClient(app)
    assert client.get("/api/books/compliance/health").json()["intake_enabled"] is False
    response = client.post("/api/books/compliance/token", json={}, headers={"Origin": "http://testserver"})
    assert response.status_code == 503
    assert counts() == {"tokens": 0, "leads": 0, "consents": 0, "aggregates": 0, "challenges": 0, "outbox": 0}


def test_token_requires_json_bounded_body_and_explicit_same_origin():
    client = TestClient(app)
    assert client.post("/api/books/compliance/token", json={}).status_code == 403
    assert client.post("/api/books/compliance/token", content="{}", headers={"Origin": "http://testserver", "Content-Type": "text/plain"}).status_code == 415
    assert client.post("/api/books/compliance/token", content="{}", headers={"Origin": "https://attacker.example", "Content-Type": "application/json"}).status_code == 403
    oversized = client.post(
        "/api/books/compliance/token",
        content="{}",
        headers={"Origin": "http://testserver", "Content-Type": "application/json", "Content-Length": "1025"},
    )
    assert oversized.status_code == 413
    assert counts()["tokens"] == 0


def test_production_order_submit_is_exactly_once_and_identifier_free():
    client = TestClient(app)
    token = issue(client)
    assert client.post("/api/books/compliance/beacon", json={"token": token, "event": "landing_view", "source": "direct", "referrer": "direct"}, headers={"Origin": "http://testserver"}).status_code == 202
    payload = intake(token).model_dump()
    first = client.post("/api/books/compliance/intake", json=payload, headers={"Origin": "http://testserver"})
    replay = client.post("/api/books/compliance/intake", json=payload, headers={"Origin": "http://testserver"})
    assert first.status_code == replay.status_code == 202
    assert first.json()["status"] == "accepted"
    assert replay.json()["status"] == "terminal"
    current = counts()
    assert current == {"tokens": 0, "leads": 1, "consents": 1, "aggregates": 1, "challenges": 1, "outbox": 1}
    with db() as conn:
        columns = {row["column_name"] for row in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name='books_compliance_funnel_aggregate'").fetchall()}
        assert not columns.intersection({"token", "token_digest", "lead_id", "email", "name", "ip", "user_agent"})


def test_missing_expired_and_replayed_token_have_zero_lead_event_aggregate_writes():
    client = TestClient(app)
    missing = intake("missing-token-000000000000000")
    assert submit_intake(missing, RequestStub())["status"] == "terminal"
    token = issue(client)
    with db() as conn:
        conn.execute("UPDATE books_compliance_funnel_token SET expires_at=now()-interval '1 second' WHERE token_digest=%s", (_digest(token),))
    assert submit_intake(intake(token), RequestStub())["status"] == "terminal"
    assert counts()["leads"] == counts()["aggregates"] == counts()["challenges"] == 0


def test_submit_vs_expiry_race_commits_one_finalizer():
    client = TestClient(app)
    token = issue(client)
    digest = _digest(token)
    with db() as conn:
        conn.execute("UPDATE books_compliance_funnel_token SET expires_at=now()-interval '1 second' WHERE token_digest=%s", (digest,))

    def submit_attempt():
        return submit_intake(intake(token), RequestStub())

    def expiry_attempt():
        with db() as conn:
            return _finalize_locked(conn, digest, "expiry")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [pool.submit(submit_attempt), pool.submit(expiry_attempt)]
        [future.result() for future in results]
    assert counts()["tokens"] == 0
    assert counts()["aggregates"] == 1
    assert counts()["leads"] == 0


@pytest.mark.parametrize("crash", ["before_delete", "after_delete"])
def test_both_finalizer_crash_windows_rollback_then_retry_once(crash):
    client = TestClient(app)
    token = issue(client)
    digest = _digest(token)
    with pytest.raises(RuntimeError):
        with db() as conn:
            _finalize_locked(conn, digest, "expiry", crash=crash)
    assert counts()["tokens"] == 1
    assert counts()["aggregates"] == 0
    with db() as conn:
        assert _finalize_locked(conn, digest, "expiry") is not None
    with db() as conn:
        assert _finalize_locked(conn, digest, "expiry") is None
    assert counts()["tokens"] == 0
    assert counts()["aggregates"] == 1


def test_unknown_event_properties_and_raw_url_are_dropped_before_persistence():
    client = TestClient(app)
    token = issue(client)
    bad_name = client.post("/api/books/compliance/beacon", json={"token": token, "event": "lead_email", "source": "direct", "referrer": "direct"}, headers={"Origin": "http://testserver"})
    raw_value = client.post("/api/books/compliance/beacon", json={"token": token, "event": "landing_view", "source": "https://example.test/?email=a@test", "referrer": "https://example.test/private", "raw_url": "https://example.test/?x=pii"}, headers={"Origin": "http://testserver"})
    assert bad_name.status_code == raw_value.status_code == 422
    with db() as conn:
        row = conn.execute("SELECT source,referrer,landing_seen FROM books_compliance_funnel_token").fetchone()
        assert row == {"source": "other", "referrer": "other", "landing_seen": False}


def test_hostile_output_encoding_email_header_and_csv_guards():
    assert safe_html('<img src=x onerror="alert(1)">') == '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    assert safe_csv("=HYPERLINK('bad')").startswith("'=")
    with pytest.raises(ValueError):
        IntakeRequest(token="t" * 24, client_nonce="n" * 16, name="Header\r\nBcc:x@test", email="x@test.example", company="Demo", consent=True)


def test_concurrent_challenge_issuance_coalesces_and_binds_one_pending_version():
    client = TestClient(app)
    token = issue(client)
    assert submit_intake(intake(token), RequestStub())["status"] == "accepted"
    with db() as conn:
        lead = conn.execute("SELECT id,email FROM books_compliance_pending_lead").fetchone()
        conn.execute("UPDATE books_compliance_challenge SET consumed_at=now()")

    def issue_again():
        with db() as conn:
            return _create_or_coalesce_challenge(conn, lead["id"], lead["email"], "email")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = [future.result() for future in [pool.submit(issue_again) for _ in range(8)]]
    assert results.count(True) == 1
    with db() as conn:
        active = conn.execute("SELECT count(*) n FROM books_compliance_challenge WHERE consumed_at IS NULL AND cancelled_at IS NULL").fetchone()["n"]
        sends = conn.execute("SELECT count(*) n FROM books_compliance_fake_outbox").fetchone()["n"]
    assert active == 1
    assert sends == 2  # original + exactly one new send


def test_recovery_is_possession_bound_single_use_and_rights_do_not_cross_destination():
    client = TestClient(app)
    token = issue(client)
    submit_intake(intake(token), RequestStub())
    assert client.post("/api/books/compliance/recovery", json={"email": "demo@example.test"}, headers={"Origin": "http://testserver"}).status_code == 202
    with db() as conn:
        delivery = conn.execute("SELECT challenge_id,bearer FROM books_compliance_fake_outbox WHERE template_id='books-compliance-recovery-v23'").fetchone()
    proof = client.post("/api/books/compliance/recovery/consume", json={"challenge_id": str(delivery["challenge_id"]), "bearer": delivery["bearer"]}, headers={"Origin": "http://testserver"})
    assert proof.status_code == 202
    session = proof.json()["recovery_session"]
    cross = client.post("/api/books/compliance/rights", json={"email": "other@example.test", "action": "erasure", "recovery_session": session}, headers={"Origin": "http://testserver"})
    assert cross.status_code == 202
    with db() as conn:
        assert conn.execute("SELECT count(*) n FROM books_compliance_rights_request").fetchone()["n"] == 0
    valid = client.post("/api/books/compliance/rights", json={"email": "demo@example.test", "action": "withdraw", "recovery_session": session}, headers={"Origin": "http://testserver"})
    replay = client.post("/api/books/compliance/rights", json={"email": "demo@example.test", "action": "erasure", "recovery_session": session}, headers={"Origin": "http://testserver"})
    assert valid.status_code == replay.status_code == 202
    with db() as conn:
        assert conn.execute("SELECT count(*) n FROM books_compliance_rights_request").fetchone()["n"] == 1


def test_destination_generation_quota_counts_generations_not_idempotency_keys():
    client = TestClient(app)
    submit_intake(intake(issue(client)), RequestStub())
    with db() as conn:
        lead = conn.execute("SELECT id,email FROM books_compliance_pending_lead").fetchone()
        conn.execute("UPDATE books_compliance_challenge SET consumed_at=now()")
    for expected in (True, True):
        with db() as conn:
            assert _create_or_coalesce_challenge(conn, lead["id"], lead["email"], "email") is expected
            conn.execute("UPDATE books_compliance_challenge SET consumed_at=now() WHERE consumed_at IS NULL")
    with db() as conn:
        assert _create_or_coalesce_challenge(conn, lead["id"], lead["email"], "email") is False
        assert conn.execute("SELECT count(*) n FROM books_compliance_challenge WHERE action='confirm'").fetchone()["n"] == 3


def test_anonymous_capacity_exhaustion_cannot_consume_recovery_partition(monkeypatch):
    monkeypatch.setenv("BOOKS_COMPLIANCE_PROVIDER_DAILY_CAPACITY", "10")
    client = TestClient(app)
    submit_intake(intake(issue(client)), RequestStub())
    with db() as conn:
        lead = conn.execute("SELECT id FROM books_compliance_pending_lead").fetchone()
        conn.execute(
            "UPDATE books_compliance_provider_capacity_bucket SET hits=7 WHERE partition='anonymous'"
        )
        assert _create_or_coalesce_challenge(conn, lead["id"], "capacity@example.test", "email") is False
    result = request_recovery(RecoveryRequest(email="capacity@example.test"), RequestStub())
    assert result["status"] == "accepted"
    with db() as conn:
        assert conn.execute("SELECT count(*) n FROM books_compliance_challenge WHERE action='recovery'").fetchone()["n"] == 1
        assert conn.execute("SELECT hits FROM books_compliance_provider_capacity_bucket WHERE partition='recovery'").fetchone()["hits"] == 1


def test_confirmation_failed_attempts_cancel_challenge_and_correct_proof_cannot_revive_it():
    client = TestClient(app)
    submit_intake(intake(issue(client)), RequestStub())
    with db() as conn:
        delivery = conn.execute("SELECT challenge_id,bearer FROM books_compliance_fake_outbox WHERE template_id='books-compliance-confirm-v23'").fetchone()
    for _ in range(5):
        response = client.post(
            "/api/books/compliance/confirmation",
            json={"challenge_id": str(delivery["challenge_id"]), "bearer": "wrong-proof-value-000000000000"},
            headers={"Origin": "http://testserver"},
        )
        assert response.status_code == 202
    replay = client.post(
        "/api/books/compliance/confirmation",
        json={"challenge_id": str(delivery["challenge_id"]), "bearer": delivery["bearer"]},
        headers={"Origin": "http://testserver"},
    )
    assert replay.status_code == 202
    with db() as conn:
        challenge = conn.execute("SELECT failed_attempts,cancelled_at,consumed_at FROM books_compliance_challenge").fetchone()
        lead = conn.execute("SELECT state,email_confirmed_at FROM books_compliance_pending_lead").fetchone()
    assert challenge["failed_attempts"] == 5 and challenge["cancelled_at"] is not None and challenge["consumed_at"] is None
    assert lead == {"state": "unverified", "email_confirmed_at": None}


def test_intake_schema_has_no_role_token_entitlement_or_payment_authority():
    with db() as conn:
        columns = {
            row["column_name"]
            for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='books_compliance_pending_lead'"
            ).fetchall()
        }
    assert not columns.intersection({"role", "token", "entitlement", "payment", "plan", "price", "subscription"})


# --- VEN-264: compliance-funnel telemetry (intake_start + guide_call_start) ---

def funnel_aggregates():
    with db() as conn:
        return {
            row["aggregate_date"].isoformat(): row
            for row in conn.execute("SELECT * FROM books_compliance_funnel_aggregate").fetchall()
        }


def test_intake_start_beacon_counts_once_per_token_and_aggregates_at_finalize():
    """VEN-264 signal 2: intake starts — a token-scoped once-only beacon at the
    first intake interaction; the count lands in the aggregate at finalize."""
    client = TestClient(app)
    token = issue(client)
    origin = {"Origin": "http://testserver"}
    body = {"token": token, "event": "intake_start", "source": "direct", "referrer": "direct"}
    first = client.post("/api/books/compliance/beacon", json=body, headers=origin)
    assert first.status_code == 202
    assert first.json() == {"status": "accepted"}
    # Replay of the same token's intake_start is a terminal no-op (once-only).
    replay = client.post("/api/books/compliance/beacon", json=body, headers=origin)
    assert replay.status_code == 202
    assert replay.json() == {"status": "terminal"}

    # Unknown tokens are terminal, not errors (fire-and-forget contract).
    stray = client.post(
        "/api/books/compliance/beacon",
        json={"token": "x" * 40, "event": "intake_start"}, headers=origin,
    )
    assert stray.status_code == 202
    assert stray.json() == {"status": "terminal"}

    # The signal is invisible until finalize; finalize (expiry sweep) lands
    # intake_start_count=1 alongside the other token-scoped signals.
    assert funnel_aggregates() == {}
    with db() as conn:
        row = conn.execute(
            "SELECT token_digest FROM books_compliance_funnel_token"
        ).fetchone()
        assert _finalize_locked(conn, row["token_digest"], "expiry")
    aggregates = list(funnel_aggregates().values())
    assert len(aggregates) == 1
    assert aggregates[0]["intake_start_count"] == 1
    assert aggregates[0]["landing_count"] == 0
    assert aggregates[0]["submit_count"] == 0


def test_intake_start_never_counts_without_finalize_or_double_counts_two_tokens():
    """Two tokens each starting intake → aggregate total 2 after both finalize;
    a token that never started intake contributes 0."""
    client = TestClient(app)
    origin = {"Origin": "http://testserver"}
    t1, t2 = issue(client), issue(client)
    client.post("/api/books/compliance/beacon", json={"token": t1, "event": "intake_start"}, headers=origin)
    with db() as conn:
        assert _finalize_locked(conn, _digest(t1), "expiry")
        assert _finalize_locked(conn, _digest(t2), "expiry")
    total = sum(row["intake_start_count"] for row in funnel_aggregates().values())
    assert total == 1  # only t1 started; t2 contributed 0


def test_guide_call_start_is_tokenless_identity_free_and_rate_limited():
    """VEN-264 signal 3: Guide call-starts from compliance surfaces — no token,
    no caller identity in storage; per-source rate limit keeps it honest."""
    client = TestClient(app)
    first = client.post("/api/books/compliance/guide-call-start", json={}, headers={"Origin": "http://testserver"})
    assert first.status_code == 202
    assert first.json() == {"status": "counted"}

    # Nothing per-visitor is persisted — only the aggregate row.
    with db() as conn:
        tokens = conn.execute("SELECT count(*) n FROM books_compliance_funnel_token").fetchone()["n"]
        assert tokens == 0
        rows = conn.execute("SELECT source, referrer, guide_call_start_count FROM books_compliance_funnel_aggregate").fetchall()
        assert len(rows) == 1
        assert rows[0]["source"] == "guide"
        assert rows[0]["referrer"] == "compliance_surface"
        assert rows[0]["guide_call_start_count"] == 1

    # Rate limit (10/hour per source): the 11th same-source call is refused.
    for _ in range(9):
        assert client.post("/api/books/compliance/guide-call-start", json={}, headers={"Origin": "http://testserver"}).status_code == 202
    assert client.post("/api/books/compliance/guide-call-start", json={}, headers={"Origin": "http://testserver"}).status_code == 429
    with db() as conn:
        total = conn.execute("SELECT coalesce(sum(guide_call_start_count),0) n FROM books_compliance_funnel_aggregate").fetchone()["n"]
    assert total == 10  # the refused call did not count


def test_guide_call_start_gate_disabled_is_503(monkeypatch):
    monkeypatch.setenv("BOOKS_COMPLIANCE_PUBLIC_INTAKE_ENABLED", "false")
    client = TestClient(app)
    assert client.post("/api/books/compliance/guide-call-start", json={}, headers={"Origin": "http://testserver"}).status_code == 503
