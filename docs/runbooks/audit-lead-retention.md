# Runbook: AuditLead intent retention and deletion (VEN-97)

Pulse: VEN-97

## Scope

`/research/order` records **intent only** for the AI-search/GEO audit offer. It must never collect card data, invoke a payment provider, fetch the prospect site, or start fulfilment. The public API is `POST /api/research/audit-leads`.

## Data collected

Each AuditLead record stores: `lead_id`, `site_url`, `contact_name`, `contact_email`, `offer_tier`, server-canonical `price_shown`, `intent`, `created_at`, `disclaimer_version`, and `dpdp_notice_version`.

## Storage and retention

- JSONL path: `HOME_AUDIT_LEAD_STORE_PATH` (default `/data/home/audit-leads.jsonl`).
- Retention: `HOME_AUDIT_LEAD_RETENTION_DAYS` (default 45 days).
- Purge helper: `app.audit_leads.purge_expired_audit_leads()` rewrites the JSONL store after removing records older than the configured retention window.

## DPDP deletion request

The notice shown at collection tells users to request deletion by emailing `privacy@shizuha.com` with the submitted contact email. Support can delete matching records with:

```python
from app.audit_leads import delete_audit_leads_by_email
delete_audit_leads_by_email("user@example.com")
```

## Safety guardrails

- Server canonicalizes `offer_tier` and `price_shown`; client-posted price is advisory only.
- The response confirms this is **not a purchase**: no payment collected, no live-site audit started, and Shizuha contacts the lead before scope/invoice/work.
- Public anti-abuse: per-IP minute rate limit and hidden `company_website` honeypot.
- Logs use `redact_audit_lead_for_log()`, which omits `contact_email` and `site_url` from normal application logs/error traces.
