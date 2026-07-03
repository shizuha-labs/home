# Shizuha Home BFF (HIVE-375)

Thin **stateless async fan-out** backend for the home command-center — the
read-aggregation layer the frontend-only home SPA lacked. Aoi-approved stack
(FastAPI + httpx + asyncio), placement (`home/backend/`, sibling container behind
the home nginx: `/api/home/*` → BFF, else → SPA). **No ORM/DB** — Django remains
the platform default for anything with models/tenant data; this is sanctioned
only as a stateless async BFF.

## Endpoint (slice 1)

`GET /api/home/summary?org_id=<optional>` → `HomeSummaryV1` (versioned envelope).

- **orgs** — from the verified JWT's `organization_memberships` claim (no downstream call).
- **widgets.tasks_by_status** — counts of the caller's tasks by status (pulse; caller's Bearer forwarded).
- Always **200 (partial)**; each widget carries `status ∈ ok|degraded|stale|unauthorized|empty` so the SPA renders shell+skeletons and hydrates independently. A slow/down source degrades ONE widget (per-source timeout), never the page.

## Tenant isolation (the load-bearing control)

- Identity + org scope come **only from the verified id-JWT** (shared HS256 `JWT_SECRET_KEY`) — never a request field.
- A requested `org_id` must be one the caller is a member of, else **403** (never leak another org's summary).
- Downstreams receive the **caller's own Bearer** — each applies its own authz; the BFF holds **no privileged service token** and can never widen scope / leak cross-org.

## Config (env)

| var | default | note |
|-----|---------|------|
| `JWT_SECRET_KEY` | (required) | shared HS256 key with shizuha-id; fail-closed if unset |
| `PULSE_API_URL` | `http://shizuha-pulse:8002` | pulse base for the tasks widget |
| `HOME_BFF_SOURCE_TIMEOUT` | `0.8` | per-source fan-out timeout (s) |

## Test

```
pip install -r requirements.txt
python -m pytest tests/ -q
```

Slice-1 tests cover the auth/tenant-scope invariants (PLAT-1236 cross-org→403,
wrong-key/expired→401, scope-from-token) and the pulse client's
graceful-degrade / unauthorized / Bearer-forwarding — all offline (TestClient +
httpx MockTransport).

## Roadmap (remaining slices — see HIVE-375)

2. `agent_activity` (hive) + `alerts`.
3. `financial_snapshot` (books, **authz-gated**) + `recent_conversations` (connect) + cortex.
4. Redis short-TTL cache + serve-stale + p95 budget verification + degradation e2e.
Deploy wiring (nginx `/api/home/*` route + sibling container + CI test gate) lands with the rollout.
