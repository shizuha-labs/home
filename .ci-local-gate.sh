#!/bin/bash
# Local mirror of home deploy-backend authz-invariant job: the SAME pytest
# selection, deps from pip-cache (as CI does).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
docker volume create home-gate-pipcache >/dev/null
docker run --rm -v "$PWD":/src -v home-gate-pipcache:/root/.cache/pip -w /src python:3.12-bookworm sh -c '
python -m pip install --quiet \
  --index-url "${PIP_INDEX_URL:-http://192.168.0.136:30511/simple/}" \
  --trusted-host 192.168.0.136 \
  -r backend/requirements.txt pytest
cd backend
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
