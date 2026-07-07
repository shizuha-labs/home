# Shizuha Home BFF (HIVE-375)

Thin **stateless async fan-out** backend for the home command-center — the
read-aggregation layer the frontend-only home SPA lacked. Aoi-approved stack
(FastAPI + httpx + asyncio), placement (`home/backend/`, sibling container behind
the home nginx: `/api/home/*` → BFF, else → SPA). **No ORM/DB** — Django remains
the platform default for anything with models/tenant data; this is sanctioned
only as a stateless async BFF.

## Endpoint (slices 1–3)

`GET /api/home/summary?org_id=<optional>` → `HomeSummaryV1` (versioned envelope).

- **orgs** — from the verified JWT's `organization_memberships` claim (no downstream call).
- **widgets.tasks_by_status** — counts of the caller's tasks by status (pulse; caller's Bearer forwarded).
- **widgets.agent_activity** — disabled/degraded until Pulse exposes an org-scoped roster endpoint.
- **widgets.alerts** — compact active alert summaries `[{sev, summary}]` (pulse alerts; caller's Bearer forwarded).
- **widgets.financial_snapshot** — compact Books dashboard totals (`cash`, receivables/payables, period P&L), **Books-authz gated** with `X-Organization-ID`; returns `unauthorized` on Books 403 and `empty` until a selected org is supplied.
- **widgets.recent_conversations** — compact Connect conversation metadata visible to the caller via forwarded Bearer.
- Always **200 (partial)**; each widget carries `status ∈ ok|degraded|stale|unauthorized|empty` so the SPA renders shell+skeletons and hydrates independently. A slow/down source degrades ONE widget (per-source timeout), never the page.
- Cache/serve-stale: successful widget payloads are cached briefly in-process (`HOME_BFF_CACHE_TTL`, default 15s) and served as `stale` during downstream brownouts up to `HOME_BFF_STALE_TTL` (default 300s).

## Tenant isolation (the load-bearing control)

- Identity + org scope come **only from the verified id-JWT** (shizuha-id **RS256**, verified against id's **JWKS**, signing key resolved by `kid`) — never a request field. Non-RS256 tokens (HS256/`none`) are rejected.
- A requested `org_id` must be one the caller is a member of, else **403** (never leak another org's summary).
- Downstreams receive the **caller's own Bearer** — each applies its own authz; the BFF holds **no privileged service token** and can never widen scope / leak cross-org.

## Config (env)

| var | default | note |
|-----|---------|------|
| `SHIZUHA_OAUTH_JWKS_URL` / `SHIZUHA_JWKS_URL` | `http://shizuha-id:8001/.well-known/jwks.json` | shizuha-id JWKS (RS256 public keys); RS256 verification fails closed if unreachable |
| `HOME_BFF_JWKS_TTL` | `600` | JWKS cache TTL (seconds) |
| `PULSE_API_URL` | `http://shizuha-pulse:8002` | pulse base for tasks/alerts |
| `ADMIN_API_URL` | `http://shizuha-admin:8003/api` | admin base for scoped organization labels |
| `HIVE_API_URL` | `http://hive.shizuha-hive.svc.cluster.local:8030/hive/api` | hive base for scoped agent activity |
| `BOOKS_API_URL` | `http://shizuha-books:8000/api` | books base for financial snapshot |
| `CONNECT_API_URL` | `http://shizuha-connect:8000/api` | connect base for recent conversations |
| `HOME_BFF_SOURCE_TIMEOUT` | `2.5` | per-source fan-out timeout (s) |
| `HOME_BFF_CACHE_TTL` | `15` | fresh widget cache TTL (s) |
| `HOME_BFF_STALE_TTL` | `300` | serve-stale window after source failure (s) |

## Test

```
pip install -r requirements.txt
python -m pytest tests/ -q
```

Tests cover the auth/tenant-scope invariants (PLAT-1236 cross-org→403,
wrong-key/expired→401, scope-from-token) and the pulse clients'
graceful-degrade / unauthorized / Bearer-forwarding — all offline (TestClient +
httpx MockTransport).

## Roadmap (remaining slices — see HIVE-375)

4. Cortex widget + PLAT-1322 probe registration once deployed.
5. Redis-backed cache if cross-replica stale sharing becomes necessary (current cache is safe best-effort per process).
Deploy wiring: nginx `/api/home/*` now proxies to the sibling backend service; chart/backend image rollout remains the deployment slice.
