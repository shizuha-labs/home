"""VEN-97 AuditLead intent intake.

Public `/research/order` captures paid intent only: no payment tokens, no card
fields, no prospect-site fetching, and no fulfillment job. Lead PII is kept in a
small append-only JSONL store for the validation window and redacted from logs.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
import secrets
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

from .config import settings

logger = logging.getLogger("home.audit_leads")

DISCLAIMER_VERSION = "v2026-07-04"
DPDP_NOTICE_VERSION = "v2026-07-05"
ALLOWED_INTENTS = {"requested", "loi", "invoice_requested"}
TIER_CONFIG = {
    "sample": {"price_shown": "₹0", "label": "Sample / demo"},
    "audit": {"price_shown": "₹1,499", "label": "AI-search visibility audit"},
    "audit_plus_recheck": {"price_shown": "₹2,499", "label": "Audit + recheck"},
}
TIER_ALIASES = {
    "sample": "sample",
    "demo": "sample",
    "ai-search-audit": "audit",
    "audit": "audit",
    "audit-recheck": "audit_plus_recheck",
    "audit_plus_recheck": "audit_plus_recheck",
    "audit+recheck": "audit_plus_recheck",
}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuditLeadRequest(BaseModel):
    site_url: str = Field(min_length=4, max_length=2048)
    contact_name: str = Field(min_length=1, max_length=120)
    contact_email: str = Field(min_length=3, max_length=254)
    offer_tier: str = Field(default="audit")
    price_shown: str | None = Field(default=None, max_length=40)
    intent: Literal["requested", "loi", "invoice_requested"] = "requested"
    disclaimer_version: str = DISCLAIMER_VERSION
    dpdp_notice_version: str = DPDP_NOTICE_VERSION
    # Honeypot: real users never fill this hidden field.
    company_website: str = ""

    @field_validator("site_url")
    @classmethod
    def validate_site_url(cls, value: str) -> str:
        value = value.strip()
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("site_url must be an http(s) URL")
        return value

    @field_validator("contact_name")
    @classmethod
    def validate_contact_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("contact_name is required")
        return value

    @field_validator("contact_email")
    @classmethod
    def validate_contact_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("contact_email must be a valid email address")
        return value

    @field_validator("offer_tier")
    @classmethod
    def validate_offer_tier(cls, value: str) -> str:
        canonical = TIER_ALIASES.get(value.strip())
        if canonical not in TIER_CONFIG:
            raise ValueError("offer_tier must be sample, audit, or audit_plus_recheck")
        return canonical

    @field_validator("disclaimer_version")
    @classmethod
    def validate_disclaimer_version(cls, value: str) -> str:
        if value != DISCLAIMER_VERSION:
            raise ValueError(f"disclaimer_version must be {DISCLAIMER_VERSION}")
        return value

    @field_validator("dpdp_notice_version")
    @classmethod
    def validate_dpdp_notice_version(cls, value: str) -> str:
        if value != DPDP_NOTICE_VERSION:
            raise ValueError(f"dpdp_notice_version must be {DPDP_NOTICE_VERSION}")
        return value

    @field_validator("company_website")
    @classmethod
    def validate_honeypot(cls, value: str) -> str:
        if value.strip():
            raise ValueError("spam submission rejected")
        return ""


class AuditLeadRecord(BaseModel):
    lead_id: str
    site_url: str
    contact_name: str
    contact_email: str
    offer_tier: str
    price_shown: str
    intent: str
    created_at: str
    disclaimer_version: str
    dpdp_notice_version: str


class AuditLeadResponse(BaseModel):
    lead_id: str
    offer_tier: str
    price_shown: str
    intent: str
    disclaimer_version: str
    dpdp_notice_version: str
    message: str


def canonical_record(payload: AuditLeadRequest) -> AuditLeadRecord:
    tier = payload.offer_tier
    return AuditLeadRecord(
        lead_id=secrets.token_urlsafe(16),
        site_url=payload.site_url,
        contact_name=payload.contact_name,
        contact_email=payload.contact_email,
        offer_tier=tier,
        # Server canonical tier/price wins; client-posted price is advisory only.
        price_shown=TIER_CONFIG[tier]["price_shown"],
        intent=payload.intent,
        created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        disclaimer_version=payload.disclaimer_version,
        dpdp_notice_version=payload.dpdp_notice_version,
    )


def redact_audit_lead_for_log(record: AuditLeadRecord) -> dict:
    return {
        "lead_id": record.lead_id,
        "offer_tier": record.offer_tier,
        "price_shown": record.price_shown,
        "intent": record.intent,
        "disclaimer_version": record.disclaimer_version,
        "dpdp_notice_version": record.dpdp_notice_version,
    }


class AuditLeadStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def append(self, record: AuditLeadRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(record.model_dump_json() + "\n")

    def read_all(self) -> list[AuditLeadRecord]:
        if not self.path.exists():
            return []
        records = []
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(AuditLeadRecord.model_validate_json(line))
        return records

    def rewrite(self, records: list[AuditLeadRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for record in records:
                f.write(record.model_dump_json() + "\n")
        tmp.replace(self.path)


def audit_lead_store() -> AuditLeadStore:
    return AuditLeadStore(settings.AUDIT_LEAD_STORE_PATH)


def persist_audit_lead(payload: AuditLeadRequest) -> AuditLeadRecord:
    record = canonical_record(payload)
    audit_lead_store().append(record)
    logger.info("AuditLead intent recorded %s", json.dumps(redact_audit_lead_for_log(record), sort_keys=True))
    return record


def purge_expired_audit_leads(now: dt.datetime | None = None, store: AuditLeadStore | None = None) -> int:
    """Delete AuditLead records older than the configured retention window."""
    store = store or audit_lead_store()
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=settings.AUDIT_LEAD_RETENTION_DAYS)
    records = store.read_all()
    kept = [r for r in records if dt.datetime.fromisoformat(r.created_at) >= cutoff]
    store.rewrite(kept)
    return len(records) - len(kept)


def delete_audit_leads_by_email(contact_email: str, store: AuditLeadStore | None = None) -> int:
    """Deletion mechanism for DPDP erasure requests handled by support."""
    store = store or audit_lead_store()
    email = contact_email.strip().lower()
    records = store.read_all()
    kept = [r for r in records if r.contact_email != email]
    store.rewrite(kept)
    return len(records) - len(kept)
