"""HIVE-375 home BFF configuration (env-driven, no secrets in code)."""
import os


class Settings:
    # Shared HS256 signing key with shizuha-id (same var the Django services use).
    JWT_SECRET_KEY: str = os.environ.get("JWT_SECRET_KEY", os.environ.get("SECRET_KEY", ""))
    JWT_ALGORITHM: str = os.environ.get("JWT_ALGORITHM", "HS256")

    # RS256/JWKS verification (canonical shizuha-id user tokens, PLAT-675/987).
    # Same envs the Django services' shizuha_auth uses; default = in-cluster id.
    JWKS_URL: str = os.environ.get(
        "SHIZUHA_OAUTH_JWKS_URL",
        (os.environ.get("SHIZUHA_EXPECTED_ISSUER") or "http://shizuha-id:8001").rstrip("/")
        + "/.well-known/jwks.json",
    )
    JWKS_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_JWKS_TTL", "600"))

    # Downstream service base URLs (in-cluster). The BFF forwards the CALLER's
    # Bearer to each — it holds NO privileged service token (the load-bearing
    # tenant-isolation control: each service applies its own authz).
    PULSE_API_URL: str = os.environ.get("PULSE_API_URL", "http://shizuha-pulse:8002").rstrip("/")
    BOOKS_API_URL: str = os.environ.get("BOOKS_API_URL", "http://shizuha-books:8000/api").rstrip("/")
    CONNECT_API_URL: str = os.environ.get("CONNECT_API_URL", "http://shizuha-connect:8000/api").rstrip("/")

    # Per-source timeout (seconds) for the async fan-out — one slow/down source
    # degrades ONE widget, never the page (async-frontends doctrine).
    SOURCE_TIMEOUT_SECONDS: float = float(os.environ.get("HOME_BFF_SOURCE_TIMEOUT", "0.8"))

    # Best-effort in-process cache. Fresh hits avoid fan-out work; stale hits are
    # served only when a source fails, so the page remains useful during brownouts.
    CACHE_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_CACHE_TTL", "15"))
    STALE_TTL_SECONDS: float = float(os.environ.get("HOME_BFF_STALE_TTL", "300"))

    # VEN-97 AuditLead intent records: no payment/fulfillment, minimal PII.
    AUDIT_LEAD_STORE_PATH: str = os.environ.get("HOME_AUDIT_LEAD_STORE_PATH", "/data/home/audit-leads.jsonl")
    AUDIT_LEAD_RETENTION_DAYS: int = int(os.environ.get("HOME_AUDIT_LEAD_RETENTION_DAYS", "45"))
    AUDIT_LEAD_RATE_LIMIT_PER_MINUTE: int = int(os.environ.get("HOME_AUDIT_LEAD_RATE_LIMIT_PER_MINUTE", "5"))


settings = Settings()
