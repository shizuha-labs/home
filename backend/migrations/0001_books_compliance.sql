-- VEN-194 / VEN-165 v23.  Additive, rollback-safe Gate-2 storage.
-- Raw funnel correlation is deliberately isolated from durable lead rows.

CREATE TABLE IF NOT EXISTS books_compliance_funnel_token (
    token_digest bytea PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    landing_seen boolean NOT NULL DEFAULT false,
    pricing_seen boolean NOT NULL DEFAULT false,
    source text NOT NULL DEFAULT 'other',
    referrer text NOT NULL DEFAULT 'other'
);

CREATE INDEX IF NOT EXISTS books_compliance_funnel_expiry_idx
    ON books_compliance_funnel_token (expires_at);

CREATE TABLE IF NOT EXISTS books_compliance_funnel_aggregate (
    aggregate_date date NOT NULL,
    source text NOT NULL,
    referrer text NOT NULL,
    landing_count bigint NOT NULL DEFAULT 0,
    pricing_count bigint NOT NULL DEFAULT 0,
    submit_count bigint NOT NULL DEFAULT 0,
    expiry_count bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (aggregate_date, source, referrer)
);

CREATE TABLE IF NOT EXISTS books_compliance_pending_lead (
    id uuid PRIMARY KEY,
    organization_id bigint NOT NULL,
    destination_hmac bytea NOT NULL,
    submission_hmac bytea NOT NULL UNIQUE,
    form_version text NOT NULL,
    notice_version text NOT NULL,
    notice_hash bytea NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    company text NOT NULL,
    phone text,
    use_cases text[] NOT NULL DEFAULT '{}',
    org_size text NOT NULL,
    state text NOT NULL DEFAULT 'unverified',
    email_confirmed_at timestamptz,
    phone_confirmed_at timestamptz,
    consent_withdrawn_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    principal_activity_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state IN ('unverified', 'verified', 'withdrawn', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS books_compliance_lead_destination_idx
    ON books_compliance_pending_lead (organization_id, destination_hmac, created_at DESC);

CREATE TABLE IF NOT EXISTS books_compliance_consent_evidence (
    id uuid PRIMARY KEY,
    lead_id uuid NOT NULL REFERENCES books_compliance_pending_lead(id) ON DELETE CASCADE,
    notice_version text NOT NULL,
    notice_hash bytea NOT NULL,
    form_version text NOT NULL,
    consented_at timestamptz NOT NULL DEFAULT now(),
    withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS books_compliance_challenge (
    id uuid PRIMARY KEY,
    lead_id uuid REFERENCES books_compliance_pending_lead(id) ON DELETE CASCADE,
    destination_hmac bytea NOT NULL,
    channel text NOT NULL,
    action text NOT NULL,
    challenge_digest bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    failed_attempts integer NOT NULL DEFAULT 0,
    consumed_at timestamptz,
    cancelled_at timestamptz,
    CHECK (channel IN ('email', 'phone')),
    CHECK (action IN ('confirm', 'recovery', 'rights_access', 'rights_erasure', 'rights_withdraw'))
);

CREATE UNIQUE INDEX IF NOT EXISTS books_compliance_one_active_challenge_idx
    ON books_compliance_challenge (destination_hmac, channel, action)
    WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS books_compliance_challenge_expiry_idx
    ON books_compliance_challenge (expires_at);

CREATE TABLE IF NOT EXISTS books_compliance_fake_outbox (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL UNIQUE REFERENCES books_compliance_challenge(id) ON DELETE CASCADE,
    organization_id bigint NOT NULL,
    channel text NOT NULL,
    destination text NOT NULL,
    template_id text NOT NULL,
    bearer text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

CREATE TABLE IF NOT EXISTS books_compliance_recovery_session (
    digest bytea PRIMARY KEY,
    destination_hmac bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS books_compliance_rights_request (
    id uuid PRIMARY KEY,
    lead_id uuid NOT NULL REFERENCES books_compliance_pending_lead(id) ON DELETE CASCADE,
    action text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK (action IN ('access', 'erasure', 'withdraw')),
    CHECK (state IN ('pending', 'resolved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS books_compliance_abuse_bucket (
    source_hmac bytea NOT NULL,
    operation text NOT NULL,
    window_start timestamptz NOT NULL,
    hits integer NOT NULL DEFAULT 0,
    PRIMARY KEY (source_hmac, operation, window_start)
);

CREATE INDEX IF NOT EXISTS books_compliance_abuse_expiry_idx
    ON books_compliance_abuse_bucket (window_start);

CREATE TABLE IF NOT EXISTS books_compliance_provider_capacity_bucket (
    partition text NOT NULL,
    window_start timestamptz NOT NULL,
    hits integer NOT NULL DEFAULT 0,
    PRIMARY KEY (partition, window_start),
    CHECK (partition IN ('anonymous', 'recovery', 'staff'))
);
