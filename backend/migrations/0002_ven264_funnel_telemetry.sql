-- VEN-264: aggregate-only first-party funnel telemetry.
-- Adds the page-view/intake-start/guide-call-start counters that accrue
-- WITHOUT the intake gate (the v23 token funnel only finalizes when intake
-- is enabled). No new identifiers: same (aggregate_date, source, referrer)
-- key, same bounded enums, drop-before-persist upstream.
ALTER TABLE books_compliance_funnel_token
    ADD COLUMN IF NOT EXISTS intake_start_seen boolean NOT NULL DEFAULT false;

ALTER TABLE books_compliance_funnel_aggregate
    ADD COLUMN IF NOT EXISTS landing_page_view_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pricing_page_view_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS intake_start_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guide_call_start_count bigint NOT NULL DEFAULT 0;
