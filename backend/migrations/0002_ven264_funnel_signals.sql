-- VEN-264: compliance-funnel telemetry for VEN-163 Gate-2 conversion
-- evidence. Additive and rollback-safe, mirroring 0001's aggregate-only
-- privacy posture: no per-visitor rows, no PII, first-party only.
--
-- 1. intake_start: a funnel-token-scoped once-only signal at the FIRST
--    intake interaction (the entry action only — never field content).
-- 2. guide_call_start: a tokenless counter for voice-Guide calls
--    originating from a compliance surface — the referrer surface tag
--    only, no caller identity (kai's VEN-264 recipe, binding).

ALTER TABLE books_compliance_funnel_token
    ADD COLUMN IF NOT EXISTS intake_started boolean NOT NULL DEFAULT false;

ALTER TABLE books_compliance_funnel_aggregate
    ADD COLUMN IF NOT EXISTS intake_start_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guide_call_start_count bigint NOT NULL DEFAULT 0;

-- Tokenless call-start attribution still needs a daily bucket keyed by the
-- surface tag; reuse the aggregate's (date, source, referrer) key with the
-- bounded attribution vocabulary.
