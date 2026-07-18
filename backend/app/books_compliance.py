"""VEN-194 privacy-safe Books Compliance Gate-2 funnel.

Postgres is the only authority. Raw correlation tokens never reach lead rows and
submit/expiry share one row-lock finalizer. Public intake defaults disabled.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import os
import re
import secrets
import threading
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import psycopg
from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg.rows import dict_row

TOKEN_TTL = timedelta(minutes=30)
CHALLENGE_TTL = timedelta(minutes=60)
RECOVERY_TTL = timedelta(minutes=15)
FORM_VERSION = "books-compliance-v23"
NOTICE_VERSION = "books-compliance-notice-v23"
NOTICE = (
    "By ticking this box, you ask Shizuha to send a confirmation message about "
    "Books Compliance Cockpit access. Contact is permitted only after channel confirmation."
)
GENERIC_RECEIVED = "Request received — please check your email to confirm. We'll reach out after you verify."
GENERIC_RIGHTS = "If a lead exists for this contact, your request will be processed under our published privacy process."
ALLOWED_ATTRIBUTION = {"direct", "google", "linkedin", "twitter", "facebook", "instagram", "other"}
ALLOWED_USE_CASES = {"gst_tracking", "pan_verify", "report_auto", "invoice_matching", "other"}
ALLOWED_ORG_SIZES = {"1-10", "11-50", "51-200", "201-1000", "1000+", "other"}
ALLOWED_VIEW_EVENTS = {"landing_view": "landing_seen", "pricing_view": "pricing_seen"}
PHONE_RE = re.compile(r"^[+0-9-]{7,20}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

CATALOG = {
    "currency": "INR",
    "disclaimer": "Validation pricing — subject to change. No payment is collected.",
    "plans": [
        {"id": "demo", "name": "Free / Demo", "price": "₹0", "cadence": "", "scope": "One entity, current-period readiness and top gaps."},
        {"id": "readiness", "name": "Readiness", "price": "₹499", "cadence": "/ month", "scope": "One entity, full checklist, calendar, gap alerts and export."},
        {"id": "multi", "name": "Multi-entity", "price": "Coming soon", "cadence": "", "scope": "Accountant workspace and multiple entities."},
    ],
}


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "true" if default else "false").strip().lower() in {"1", "true", "yes", "on"}


def intake_enabled() -> bool:
    return _env_bool("BOOKS_COMPLIANCE_PUBLIC_INTAKE_ENABLED")


def database_url() -> str:
    return os.environ.get("BOOKS_COMPLIANCE_DATABASE_URL", "")


def _key(name: str) -> bytes:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"{name} is required when Books Compliance intake is enabled")
    return value.encode()


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def _mac(key_name: str, value: str) -> bytes:
    return hmac.new(_key(key_name), value.encode(), hashlib.sha256).digest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_text(value: str, maximum: int) -> str:
    value = unicodedata.normalize("NFC", value.strip())
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("control characters are not allowed")
    if not value or len(value) > maximum:
        raise ValueError(f"must contain 1 to {maximum} characters")
    return value


def normalize_email(value: str) -> str:
    value = normalize_text(value, 254).lower()
    if not EMAIL_RE.fullmatch(value):
        raise ValueError("invalid email")
    return value


def safe_html(value: str) -> str:
    """Context-safe outreach rendering primitive; never mark this output safe again."""
    return html.escape(value, quote=True)


def safe_csv(value: str) -> str:
    """Neutralize spreadsheet formula injection before a future governed export."""
    value = value.replace("\r", " ").replace("\n", " ")
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t")) else value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TokenRequest(StrictModel):
    pass


class BeaconRequest(StrictModel):
    token: str = Field(min_length=20, max_length=128)
    event: Literal["landing_view", "pricing_view"]
    source: str = "other"
    referrer: str = "other"

    @field_validator("source", "referrer")
    @classmethod
    def bounded_attribution(cls, value: str) -> str:
        return value if value in ALLOWED_ATTRIBUTION else "other"


class IntakeRequest(StrictModel):
    token: str = Field(min_length=20, max_length=128)
    client_nonce: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str
    email: str
    company: str
    phone: str | None = None
    use_cases: list[str] = Field(default_factory=list, max_length=3)
    org_size: str = "other"
    consent: Literal[True]
    source: str = "other"

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return normalize_text(value, 100)

    @field_validator("company")
    @classmethod
    def valid_company(cls, value: str) -> str:
        return normalize_text(value, 200)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value: str | None) -> str | None:
        if value in {None, ""}:
            return None
        value = normalize_text(value, 20)
        if not PHONE_RE.fullmatch(value):
            raise ValueError("invalid phone")
        return value

    @field_validator("use_cases")
    @classmethod
    def valid_use_cases(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("duplicate use case")
        return [value if value in ALLOWED_USE_CASES else "other" for value in values]

    @field_validator("org_size")
    @classmethod
    def valid_org_size(cls, value: str) -> str:
        return value if value in ALLOWED_ORG_SIZES else "other"

    @field_validator("source")
    @classmethod
    def valid_source(cls, value: str) -> str:
        return value if value in ALLOWED_ATTRIBUTION else "other"


class ChallengeConsumeRequest(StrictModel):
    challenge_id: uuid.UUID
    bearer: str = Field(min_length=20, max_length=160)


class RecoveryRequest(StrictModel):
    email: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return normalize_email(value)


class RightsRequest(StrictModel):
    email: str
    action: Literal["access", "erasure", "withdraw"]
    recovery_session: str = Field(min_length=20, max_length=160)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return normalize_email(value)


_migration_lock = threading.Lock()
_migrated_dsn: set[str] = set()


def ensure_schema() -> None:
    dsn = database_url()
    if not dsn:
        raise RuntimeError("BOOKS_COMPLIANCE_DATABASE_URL is required")
    if dsn in _migrated_dsn:
        return
    with _migration_lock:
        if dsn in _migrated_dsn:
            return
        migration = Path(__file__).parents[1] / "migrations" / "0001_books_compliance.sql"
        with psycopg.connect(dsn) as conn:
            conn.execute(migration.read_text())
        _migrated_dsn.add(dsn)


@contextmanager
def db():
    ensure_schema()
    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        yield conn


def require_enabled() -> None:
    if not intake_enabled():
        raise HTTPException(status_code=503, detail={"code": "intake_not_open", "message": "Public requests are not open yet."})


def require_json(request: Request, maximum: int) -> None:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="application/json required")
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > maximum):
        raise HTTPException(status_code=413, detail="request too large")
    allowed = {item.strip() for item in os.environ.get("BOOKS_COMPLIANCE_ALLOWED_ORIGINS", "https://shizuha.com").split(",") if item.strip()}
    origin = request.headers.get("origin")
    if not origin or origin not in allowed:
        raise HTTPException(status_code=403, detail="origin rejected")


def source_fingerprint(request: Request) -> bytes:
    # Abuse-only, purpose-limited HMAC. Never enters events/logs/lead rows.
    host = request.client.host if request.client else "unknown"
    return _mac("BOOKS_COMPLIANCE_ABUSE_HMAC_KEY", host)


def rate_limit(conn: psycopg.Connection, request: Request, operation: str, limit: int, hours: int = 1) -> None:
    now = _now()
    seconds = hours * 3600
    window = datetime.fromtimestamp((int(now.timestamp()) // seconds) * seconds, timezone.utc)
    row = conn.execute(
        """INSERT INTO books_compliance_abuse_bucket(source_hmac, operation, window_start, hits)
           VALUES (%s, %s, %s, 1)
           ON CONFLICT (source_hmac, operation, window_start)
           DO UPDATE SET hits=books_compliance_abuse_bucket.hits+1 RETURNING hits""",
        (source_fingerprint(request), operation, window),
    ).fetchone()
    if row["hits"] > limit:
        raise HTTPException(status_code=429, detail="Please wait a minute and try once more.")


def reserve_provider_capacity(conn: psycopg.Connection, partition: Literal["anonymous", "recovery", "staff"]) -> bool:
    """Atomically preserve the 70/20/10 daily provider-capacity partitions."""
    total = max(10, int(os.environ.get("BOOKS_COMPLIANCE_PROVIDER_DAILY_CAPACITY", "1000")))
    ratios = {"anonymous": 70, "recovery": 20, "staff": 10}
    limit = max(1, total * ratios[partition] // 100)
    now = _now()
    window = now.replace(hour=0, minute=0, second=0, microsecond=0)
    row = conn.execute(
        """INSERT INTO books_compliance_provider_capacity_bucket(partition,window_start,hits)
           VALUES (%s,%s,1)
           ON CONFLICT (partition,window_start) DO UPDATE
             SET hits=books_compliance_provider_capacity_bucket.hits+1
             WHERE books_compliance_provider_capacity_bucket.hits < %s
           RETURNING hits""",
        (partition, window, limit),
    ).fetchone()
    return row is not None


def issue_token(request: Request) -> dict[str, Any]:
    require_enabled()
    raw = secrets.token_urlsafe(24)
    now = _now()
    with db() as conn:
        rate_limit(conn, request, "token", 30)
        conn.execute(
            "INSERT INTO books_compliance_funnel_token(token_digest, created_at, expires_at) VALUES (%s,%s,%s)",
            (_digest(raw), now, now + TOKEN_TTL),
        )
    return {"token": raw, "expires_in": int(TOKEN_TTL.total_seconds())}


def record_beacon(payload: BeaconRequest) -> dict[str, str]:
    require_enabled()
    field = ALLOWED_VIEW_EVENTS[payload.event]
    with db() as conn:
        row = conn.execute(
            f"""UPDATE books_compliance_funnel_token
                SET {field}=true,
                    source=CASE WHEN source='other' THEN %s ELSE source END,
                    referrer=CASE WHEN referrer='other' THEN %s ELSE referrer END
                WHERE token_digest=%s AND expires_at>now()
                RETURNING token_digest""",
            (payload.source, payload.referrer, _digest(payload.token)),
        ).fetchone()
    return {"status": "accepted" if row else "terminal"}


def _finalize_locked(conn: psycopg.Connection, digest: bytes, cause: Literal["submit", "expiry"], *, crash: str | None = None) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM books_compliance_funnel_token WHERE token_digest=%s FOR UPDATE",
        (digest,),
    ).fetchone()
    if not row:
        return None
    if cause == "submit" and row["expires_at"] <= _now():
        return None
    submit = 1 if cause == "submit" else 0
    expiry = 1 if cause == "expiry" else 0
    conn.execute(
        """INSERT INTO books_compliance_funnel_aggregate
           (aggregate_date,source,referrer,landing_count,pricing_count,submit_count,expiry_count)
           VALUES (current_date,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (aggregate_date,source,referrer) DO UPDATE SET
             landing_count=books_compliance_funnel_aggregate.landing_count+EXCLUDED.landing_count,
             pricing_count=books_compliance_funnel_aggregate.pricing_count+EXCLUDED.pricing_count,
             submit_count=books_compliance_funnel_aggregate.submit_count+EXCLUDED.submit_count,
             expiry_count=books_compliance_funnel_aggregate.expiry_count+EXCLUDED.expiry_count""",
        (row["source"], row["referrer"], int(row["landing_seen"]), int(row["pricing_seen"]), submit, expiry),
    )
    if crash == "before_delete":
        raise RuntimeError("VEN-194 crash-window fixture before delete")
    conn.execute("DELETE FROM books_compliance_funnel_token WHERE token_digest=%s", (digest,))
    if crash == "after_delete":
        raise RuntimeError("VEN-194 crash-window fixture after delete")
    return row


def _create_or_coalesce_challenge(conn: psycopg.Connection, lead_id: uuid.UUID, destination: str, channel: str) -> bool:
    destination_hmac = _mac("BOOKS_COMPLIANCE_DESTINATION_HMAC_KEY", f"{channel}:{destination}")
    # One destination operation at a time across replicas. The partial unique
    # index is the final guard; this lock makes coalescing deterministic rather
    # than turning a concurrent loser into a database error.
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(encode(%s,'hex'),0))", (destination_hmac,))
    conn.execute(
        """UPDATE books_compliance_challenge SET cancelled_at=now()
           WHERE destination_hmac=%s AND channel=%s AND action='confirm'
             AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at<=now()""",
        (destination_hmac, channel),
    )
    active = conn.execute(
        """SELECT id FROM books_compliance_challenge
           WHERE destination_hmac=%s AND channel=%s AND action='confirm'
             AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()
           FOR UPDATE""",
        (destination_hmac, channel),
    ).fetchone()
    if active:
        return False
    generations = conn.execute(
        """SELECT count(*) AS n FROM books_compliance_challenge
           WHERE destination_hmac=%s AND channel=%s AND action='confirm'
             AND created_at>now()-interval '24 hours'""",
        (destination_hmac, channel),
    ).fetchone()["n"]
    if generations >= 3:
        return False
    siblings = conn.execute(
        """SELECT count(*) AS n FROM books_compliance_challenge
           WHERE destination_hmac=%s AND created_at>now()-interval '30 days'
             AND consumed_at IS NULL AND cancelled_at IS NULL""",
        (destination_hmac,),
    ).fetchone()["n"]
    if siblings >= 5 or not reserve_provider_capacity(conn, "anonymous"):
        return False
    bearer = secrets.token_urlsafe(32)
    challenge_id = uuid.uuid4()
    conn.execute(
        """INSERT INTO books_compliance_challenge
           (id,lead_id,destination_hmac,channel,action,challenge_digest,expires_at)
           VALUES (%s,%s,%s,%s,'confirm',%s,%s)""",
        (challenge_id, lead_id, destination_hmac, channel, _digest(bearer), _now() + CHALLENGE_TTL),
    )
    if _env_bool("BOOKS_COMPLIANCE_FAKE_PROVIDER_ENABLED", True):
        conn.execute(
            """INSERT INTO books_compliance_fake_outbox
               (id,challenge_id,organization_id,channel,destination,template_id,bearer)
               VALUES (%s,%s,%s,%s,%s,'books-compliance-confirm-v23',%s)""",
            (uuid.uuid4(), challenge_id, int(os.environ.get("BOOKS_COMPLIANCE_ORGANIZATION_ID", "1")), channel, destination, bearer),
        )
    return True


def submit_intake(payload: IntakeRequest, request: Request, *, crash: str | None = None) -> dict[str, str]:
    require_enabled()
    now = _now()
    destination_hmac = _mac("BOOKS_COMPLIANCE_DESTINATION_HMAC_KEY", f"email:{payload.email}")
    bucket = int(now.timestamp()) // 3600
    submission_hmac = _mac(
        "BOOKS_COMPLIANCE_SUBMISSION_HMAC_KEY",
        f"{payload.email}|{FORM_VERSION}|{payload.client_nonce}|{bucket}",
    )
    notice_hash = hashlib.sha256(NOTICE.encode()).digest()
    with db() as conn:
        rate_limit(conn, request, "submit", 10, hours=24)
        token_row = _finalize_locked(conn, _digest(payload.token), "submit", crash=crash)
        if token_row is None:
            return {"status": "terminal", "message": "This request link is no longer active. Please refresh and try again."}
        lead_id = uuid.uuid4()
        inserted = conn.execute(
            """INSERT INTO books_compliance_pending_lead
               (id,organization_id,destination_hmac,submission_hmac,form_version,notice_version,notice_hash,
                name,email,company,phone,use_cases,org_size)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (submission_hmac) DO NOTHING RETURNING id""",
            (lead_id, int(os.environ.get("BOOKS_COMPLIANCE_ORGANIZATION_ID", "1")), destination_hmac,
             submission_hmac, FORM_VERSION, NOTICE_VERSION, notice_hash, payload.name, payload.email,
             payload.company, payload.phone, payload.use_cases, payload.org_size),
        ).fetchone()
        if inserted:
            conn.execute(
                """INSERT INTO books_compliance_consent_evidence
                   (id,lead_id,notice_version,notice_hash,form_version) VALUES (%s,%s,%s,%s,%s)""",
                (uuid.uuid4(), lead_id, NOTICE_VERSION, notice_hash, FORM_VERSION),
            )
            _create_or_coalesce_challenge(conn, lead_id, payload.email, "email")
    return {"status": "accepted", "message": GENERIC_RECEIVED}


def consume_confirmation(payload: ChallengeConsumeRequest) -> dict[str, str]:
    require_enabled()
    with db() as conn:
        row = conn.execute(
            """SELECT id,lead_id,channel,challenge_digest,failed_attempts
               FROM books_compliance_challenge WHERE id=%s AND action='confirm'
                 AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()
               FOR UPDATE""",
            (payload.challenge_id,),
        ).fetchone()
        if row and hmac.compare_digest(bytes(row["challenge_digest"]), _digest(payload.bearer)):
            conn.execute("UPDATE books_compliance_challenge SET consumed_at=now() WHERE id=%s", (row["id"],))
            column = "email_confirmed_at" if row["channel"] == "email" else "phone_confirmed_at"
            conn.execute(
                f"UPDATE books_compliance_pending_lead SET {column}=now(), state='verified', principal_activity_at=now() WHERE id=%s",
                (row["lead_id"],),
            )
        elif row:
            conn.execute(
                """UPDATE books_compliance_challenge
                   SET failed_attempts=failed_attempts+1,
                       cancelled_at=CASE WHEN failed_attempts+1>=5 THEN now() ELSE cancelled_at END
                   WHERE id=%s""",
                (row["id"],),
            )
    return {"status": "accepted", "message": "Confirmation processed."}


def request_recovery(payload: RecoveryRequest, request: Request) -> dict[str, str]:
    require_enabled()
    destination_hmac = _mac("BOOKS_COMPLIANCE_DESTINATION_HMAC_KEY", f"email:{payload.email}")
    with db() as conn:
        rate_limit(conn, request, "recovery", 5, hours=24 * 7)
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(encode(%s,'hex'),0))", (destination_hmac,))
        conn.execute(
            """UPDATE books_compliance_challenge SET cancelled_at=now()
               WHERE destination_hmac=%s AND action='recovery' AND consumed_at IS NULL
                 AND cancelled_at IS NULL AND expires_at<=now()""",
            (destination_hmac,),
        )
        existing = conn.execute(
            """SELECT id FROM books_compliance_challenge WHERE destination_hmac=%s AND action='recovery'
               AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now() FOR UPDATE""",
            (destination_hmac,),
        ).fetchone()
        if not existing:
            generated = conn.execute(
                """SELECT count(*) AS n FROM books_compliance_challenge
                   WHERE destination_hmac=%s AND action='recovery'
                     AND created_at>now()-interval '7 days'""",
                (destination_hmac,),
            ).fetchone()["n"]
            if generated >= 1 or not reserve_provider_capacity(conn, "recovery"):
                return {"status": "accepted", "message": GENERIC_RIGHTS}
            bearer = secrets.token_urlsafe(32)
            cid = uuid.uuid4()
            conn.execute(
                """INSERT INTO books_compliance_challenge
                   (id,destination_hmac,channel,action,challenge_digest,expires_at)
                   VALUES (%s,%s,'email','recovery',%s,%s)""",
                (cid, destination_hmac, _digest(bearer), _now() + CHALLENGE_TTL),
            )
            if _env_bool("BOOKS_COMPLIANCE_FAKE_PROVIDER_ENABLED", True):
                conn.execute(
                    """INSERT INTO books_compliance_fake_outbox
                       (id,challenge_id,organization_id,channel,destination,template_id,bearer)
                       VALUES (%s,%s,%s,'email',%s,'books-compliance-recovery-v23',%s)""",
                    (uuid.uuid4(), cid, int(os.environ.get("BOOKS_COMPLIANCE_ORGANIZATION_ID", "1")), payload.email, bearer),
                )
    return {"status": "accepted", "message": GENERIC_RIGHTS}


def consume_recovery(payload: ChallengeConsumeRequest) -> dict[str, str]:
    require_enabled()
    session = secrets.token_urlsafe(32)
    with db() as conn:
        row = conn.execute(
            """SELECT id,destination_hmac,challenge_digest,failed_attempts
               FROM books_compliance_challenge WHERE id=%s AND action='recovery'
                 AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()
               FOR UPDATE""",
            (payload.challenge_id,),
        ).fetchone()
        if not row or not hmac.compare_digest(bytes(row["challenge_digest"]), _digest(payload.bearer)):
            if row:
                conn.execute(
                    """UPDATE books_compliance_challenge
                       SET failed_attempts=failed_attempts+1,
                           cancelled_at=CASE WHEN failed_attempts+1>=5 THEN now() ELSE cancelled_at END
                       WHERE id=%s""",
                    (row["id"],),
                )
            return {"status": "terminal", "message": "Recovery proof is no longer active."}
        conn.execute("UPDATE books_compliance_challenge SET consumed_at=now() WHERE id=%s", (row["id"],))
        conn.execute(
            "INSERT INTO books_compliance_recovery_session(digest,destination_hmac,expires_at) VALUES (%s,%s,%s)",
            (_digest(session), row["destination_hmac"], _now() + RECOVERY_TTL),
        )
    return {"status": "accepted", "recovery_session": session, "expires_in": int(RECOVERY_TTL.total_seconds())}


def create_rights_request(payload: RightsRequest) -> dict[str, str]:
    require_enabled()
    destination_hmac = _mac("BOOKS_COMPLIANCE_DESTINATION_HMAC_KEY", f"email:{payload.email}")
    with db() as conn:
        session = conn.execute(
            """UPDATE books_compliance_recovery_session SET consumed_at=now()
               WHERE digest=%s AND destination_hmac=%s AND consumed_at IS NULL AND expires_at>now()
               RETURNING digest""",
            (_digest(payload.recovery_session), destination_hmac),
        ).fetchone()
        if session:
            lead = conn.execute(
                """SELECT id FROM books_compliance_pending_lead
                   WHERE destination_hmac=%s ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                (destination_hmac,),
            ).fetchone()
            if lead:
                conn.execute(
                    "INSERT INTO books_compliance_rights_request(id,lead_id,action) VALUES (%s,%s,%s)",
                    (uuid.uuid4(), lead["id"], payload.action),
                )
                if payload.action == "withdraw":
                    conn.execute(
                        "UPDATE books_compliance_pending_lead SET state='withdrawn',consent_withdrawn_at=now() WHERE id=%s",
                        (lead["id"],),
                    )
    return {"status": "accepted", "message": GENERIC_RIGHTS}


def sweep_expired(limit: int = 250) -> dict[str, int]:
    """Idempotent operational retention worker; safe to resume after interruption."""
    finalized = 0
    deleted = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT token_digest FROM books_compliance_funnel_token WHERE expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT %s",
            (limit,),
        ).fetchall()
        for row in rows:
            if _finalize_locked(conn, row["token_digest"], "expiry"):
                finalized += 1
        conn.execute("DELETE FROM books_compliance_challenge WHERE expires_at<now()-interval '30 days'")
        conn.execute("DELETE FROM books_compliance_abuse_bucket WHERE window_start<now()-interval '30 days'")
        conn.execute("DELETE FROM books_compliance_provider_capacity_bucket WHERE window_start<now()-interval '30 days'")
        result = conn.execute(
            """DELETE FROM books_compliance_pending_lead
               WHERE (state='unverified' AND created_at<now()-interval '30 days')
                  OR (state IN ('withdrawn','cancelled') AND created_at<now()-interval '30 days')
                  OR created_at<now()-interval '24 months'"""
        )
        deleted = result.rowcount
        conn.execute("DELETE FROM books_compliance_rights_request WHERE resolved_at<now()-interval '1 year'")
    return {"funnel_finalized": finalized, "leads_deleted": deleted}
