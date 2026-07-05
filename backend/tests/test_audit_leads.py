import datetime as dt
import json
import logging
import os

# Keep shared app settings compatible with existing auth tests when this module imports first.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-hive375")

from fastapi.testclient import TestClient

from app.audit_leads import (
    DISCLAIMER_VERSION,
    DPDP_NOTICE_VERSION,
    AuditLeadRecord,
    AuditLeadStore,
    delete_audit_leads_by_email,
    purge_expired_audit_leads,
)
from app.config import settings
from app.main import app, _clear_audit_lead_rate_limits_for_tests


def _payload(**overrides):
    data = {
        "site_url": "https://example.com",
        "contact_name": "Alex Chen",
        "contact_email": "ALEX@example.com",
        "offer_tier": "audit",
        "price_shown": "₹999999",
        "intent": "requested",
        "disclaimer_version": DISCLAIMER_VERSION,
        "dpdp_notice_version": DPDP_NOTICE_VERSION,
        "company_website": "",
    }
    data.update(overrides)
    return data


def _client(tmp_path, monkeypatch, rate_limit=5):
    monkeypatch.setattr(settings, "AUDIT_LEAD_STORE_PATH", str(tmp_path / "audit-leads.jsonl"))
    monkeypatch.setattr(settings, "AUDIT_LEAD_RETENTION_DAYS", 45)
    monkeypatch.setattr(settings, "AUDIT_LEAD_RATE_LIMIT_PER_MINUTE", rate_limit)
    _clear_audit_lead_rate_limits_for_tests()
    return TestClient(app)


def _records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_valid_submit_persists_canonical_record_without_payment(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.post("/api/research/audit-leads", json=_payload(offer_tier="ai-search-audit"))

    assert response.status_code == 201
    body = response.json()
    assert body["lead_id"]
    assert body["offer_tier"] == "audit"
    assert body["price_shown"] == "₹1,499"  # server canonical price overrides client advisory value
    assert body["disclaimer_version"] == DISCLAIMER_VERSION
    assert "not a purchase" in body["message"]
    assert "no payment" in body["message"]
    assert "no live-site audit" in body["message"]
    assert "payment" not in set(body)
    assert "card" not in set(body)

    stored = _records(tmp_path / "audit-leads.jsonl")
    assert len(stored) == 1
    assert stored[0]["lead_id"] == body["lead_id"]
    assert stored[0]["site_url"] == "https://example.com"
    assert stored[0]["contact_email"] == "alex@example.com"
    assert stored[0]["offer_tier"] == "audit"
    assert stored[0]["price_shown"] == "₹1,499"


def test_invalid_and_honeypot_submissions_are_rejected(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    bad_url = client.post("/api/research/audit-leads", json=_payload(site_url="javascript:alert(1)"))
    assert bad_url.status_code == 422
    assert "javascript:alert" not in bad_url.text

    bad_email = client.post("/api/research/audit-leads", json=_payload(contact_email="not-an-email"))
    assert bad_email.status_code == 422
    assert "not-an-email" not in bad_email.text

    honeypot = client.post("/api/research/audit-leads", json=_payload(company_website="bot.example"))
    assert honeypot.status_code == 422

    assert not (tmp_path / "audit-leads.jsonl").exists()


def test_rate_limit_rejects_abuse(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, rate_limit=2)

    assert client.post("/api/research/audit-leads", json=_payload(contact_email="one@example.com")).status_code == 201
    assert client.post("/api/research/audit-leads", json=_payload(contact_email="two@example.com")).status_code == 201
    limited = client.post("/api/research/audit-leads", json=_payload(contact_email="three@example.com"))

    assert limited.status_code == 429
    assert "Too many" in limited.json()["detail"]


def test_audit_lead_logs_redact_email_and_site_url(tmp_path, monkeypatch, caplog):
    client = _client(tmp_path, monkeypatch)
    caplog.set_level(logging.INFO, logger="home.audit_leads")

    response = client.post("/api/research/audit-leads", json=_payload(
        site_url="https://secret.example/private",
        contact_email="secret.person@example.com",
    ))

    assert response.status_code == 201
    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "AuditLead intent recorded" in log_text
    assert response.json()["lead_id"] in log_text
    assert "secret.person@example.com" not in log_text
    assert "https://secret.example/private" not in log_text
    assert "site_url" not in log_text
    assert "contact_email" not in log_text


def test_retention_purge_and_email_deletion_mechanism(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "AUDIT_LEAD_RETENTION_DAYS", 45)
    store = AuditLeadStore(tmp_path / "audit-leads.jsonl")
    now = dt.datetime(2026, 7, 5, tzinfo=dt.timezone.utc)

    old = AuditLeadRecord(
        lead_id="old",
        site_url="https://old.example",
        contact_name="Old Lead",
        contact_email="delete@example.com",
        offer_tier="audit",
        price_shown="₹1,499",
        intent="requested",
        created_at=(now - dt.timedelta(days=46)).isoformat(),
        disclaimer_version=DISCLAIMER_VERSION,
        dpdp_notice_version=DPDP_NOTICE_VERSION,
    )
    current = AuditLeadRecord(
        lead_id="current",
        site_url="https://current.example",
        contact_name="Current Lead",
        contact_email="delete@example.com",
        offer_tier="audit_plus_recheck",
        price_shown="₹2,499",
        intent="requested",
        created_at=(now - dt.timedelta(days=10)).isoformat(),
        disclaimer_version=DISCLAIMER_VERSION,
        dpdp_notice_version=DPDP_NOTICE_VERSION,
    )
    other = AuditLeadRecord(
        lead_id="other",
        site_url="https://other.example",
        contact_name="Other Lead",
        contact_email="other@example.com",
        offer_tier="sample",
        price_shown="₹0",
        intent="requested",
        created_at=now.isoformat(),
        disclaimer_version=DISCLAIMER_VERSION,
        dpdp_notice_version=DPDP_NOTICE_VERSION,
    )
    for record in (old, current, other):
        store.append(record)

    assert purge_expired_audit_leads(now=now, store=store) == 1
    assert [record.lead_id for record in store.read_all()] == ["current", "other"]

    assert delete_audit_leads_by_email("DELETE@example.com", store=store) == 1
    assert [record.lead_id for record in store.read_all()] == ["other"]
