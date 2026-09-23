#!/bin/bash
# Local mirror of home deploy-backend authz-invariant job: the SAME pytest
# selection from the locked uv project (backend/pyproject.toml + backend/uv.lock),
# as CI does. PLAT-5821: no more pip -r requirements.txt — uv sync --locked.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# The locked wheel URLs use cluster DNS. A host-side Docker gate does not
# inherit CoreDNS, so resolve the current Service instead of pinning a node IP.
home_gate_cache_host=pip-cache.registry.svc.cluster.local
home_gate_cache_ip=${SHIZUHA_PIP_CACHE_IP:-}
if [ -z "$home_gate_cache_ip" ]; then
  home_gate_cache_ip=$(getent ahostsv4 "$home_gate_cache_host" | awk 'NR == 1 { print $1 }' || true)
fi
if [ -z "$home_gate_cache_ip" ]; then
  home_gate_cache_ip=$(kubectl --request-timeout=10s -n registry get service pip-cache -o jsonpath='{.spec.clusterIP}')
fi
[ -n "$home_gate_cache_ip" ] || { echo 'gate: cannot resolve the locked package cache service' >&2; exit 1; }
docker volume create home-gate-pipcache >/dev/null
# Honour an explicitly configured package mirror; otherwise pip uses PyPI.
# The former workstation IP is no longer a reachable package service.
docker run --rm -v "$PWD":/src -v home-gate-pipcache:/root/.cache/pip \
  --add-host "$home_gate_cache_host:$home_gate_cache_ip" \
  -e PIP_INDEX_URL -e PIP_TRUSTED_HOST -w /src python:3.12-bookworm sh -ec '
python -m pip install --quiet uv==0.11.26
cd backend
env -u UV_INDEX_URL -u UV_DEFAULT_INDEX -u UV_INSECURE_HOST uv lock --check
env -u UV_INDEX_URL -u UV_DEFAULT_INDEX -u UV_INSECURE_HOST uv sync --locked --extra dev
. .venv/bin/activate
python -m pytest -q \
  tests/test_summary.py::test_requesting_foreign_org_is_403 \
  tests/test_summary.py::test_two_org_authz_matrix_rejects_selectors_and_stale_claim_cache \
  tests/test_summary.py::test_widget_cache_does_not_serve_stale_over_unauthorized \
  tests/test_summary.py::test_financial_cache_revalidates_books_authz_inside_fresh_ttl \
  tests/test_activity.py::test_activity_foreign_org_is_403 \
  tests/test_activity.py::test_activity_two_org_cache_and_selector_isolation \
  tests/test_activity.py::test_activity_recent_single_org_foreign_org_is_403 \
  tests/test_activity.py::test_activity_recent_aggregate_excludes_non_member_orgs \
  tests/test_activity.py::test_activity_stream_foreign_org_is_403 \
  tests/test_activity.py::test_parse_entry_drops_wrong_org \
  tests/test_activity.py::test_activity_recent_aggregate_excludes_deauth_org_events'
