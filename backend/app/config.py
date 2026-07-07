"""HIVE-375 home BFF configuration (env-driven, no secrets in code)."""
import os


class Settings:
    # Shizuha ID issues RS256 tokens and publishes the public keys via JWKS.
    SHIZUHA_ID_URL: str = os.environ.get("SHIZUHA_ID_URL", "http://shizuha-id:8001").rstrip("/")
    SHIZUHA_JWKS_URL: str = os.environ.get(
        "SHIZUHA_JWKS_URL",
        os.environ.get("SHIZUHA_ID_JWKS_URL", f"{SHIZUHA_ID_URL}/.well-known/jwks.json"),
    ).rstrip("/")

    # RS256/JWKS verification (canonical shizuha-id user tokens, PLAT-675/987).
    # JWKS_URL is the SINGLE source of truth the verifier (auth.py) fetches, so
    # it MUST honor every documented alias in precedence order — otherwise an
    # operator who sets the documented SHIZUHA_JWKS_URL would be silently ignored
    # and the BFF would fetch the wrong endpoint and 401 real users (HIVE-474 /
    # revi P2). Order: SHIZUHA_OAUTH_JWKS_URL (Django shizuha_auth canonical) →
    # SHIZUHA_JWKS_URL → SHIZUHA_ID_JWKS_URL → (SHIZUHA_EXPECTED_ISSUER |
    # SHIZUHA_ID_URL)/.well-known/jwks.json (in-cluster default).
    JWKS_URL: str = (
        os.environ.get("SHIZUHA_OAUTH_JWKS_URL")
        or os.environ.get("SHIZUHA_JWKS_URL")
        or os.environ.get("SHIZUHA_ID_JWKS_URL")
        or (
            (os.environ.get("SHIZUHA_EXPECTED_ISSUER") or SHIZUHA_ID_URL).rstrip("/")
            + "/.well-known/jwks.json"
        )
    ).rstrip("/")
    JWKS_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_JWKS_TTL", "600"))

    # Downstream service base URLs (in-cluster). The BFF forwards the CALLER's
    # Bearer to each — it holds NO privileged service token (the load-bearing
    # tenant-isolation control: each service applies its own authz).
    PULSE_API_URL: str = os.environ.get("PULSE_API_URL", "http://shizuha-pulse:8002").rstrip("/")
    ADMIN_API_URL: str = os.environ.get("ADMIN_API_URL", "http://shizuha-admin:8003/api").rstrip("/")
    HIVE_API_URL: str = os.environ.get(
        "HIVE_API_URL",
        "http://hive.shizuha-hive.svc.cluster.local:8030/hive/api",
    ).rstrip("/")
    BOOKS_API_URL: str = os.environ.get("BOOKS_API_URL", "http://shizuha-books:8000/api").rstrip("/")
    CONNECT_API_URL: str = os.environ.get("CONNECT_API_URL", "http://shizuha-connect:8000/api").rstrip("/")

    # Per-source timeout (seconds) for the async fan-out — one slow/down source
    # degrades ONE widget, never the page (async-frontends doctrine).
    SOURCE_TIMEOUT_SECONDS: float = float(os.environ.get("HOME_BFF_SOURCE_TIMEOUT", "2.5"))

    # Best-effort in-process cache. Fresh hits avoid fan-out work; stale hits are
    # served only when a source fails, so the page remains useful during brownouts.
    CACHE_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_CACHE_TTL", "15"))
    STALE_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_STALE_TTL", "300"))

    # VEN-97 AuditLead intent records: no payment/fulfillment, minimal PII.
    AUDIT_LEAD_STORE_PATH: str = os.environ.get("HOME_AUDIT_LEAD_STORE_PATH", "/data/home/audit-leads.jsonl")
    AUDIT_LEAD_RETENTION_DAYS: int = int(os.environ.get("HOME_AUDIT_LEAD_RETENTION_DAYS", "45"))
    AUDIT_LEAD_RATE_LIMIT_PER_MINUTE: int = int(os.environ.get("HOME_AUDIT_LEAD_RATE_LIMIT_PER_MINUTE", "5"))


settings = Settings()
