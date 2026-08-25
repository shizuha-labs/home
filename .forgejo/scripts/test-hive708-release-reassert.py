#!/usr/bin/env python3
"""HIVE-708: both independent image lanes must beat a chart snapshot race."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class HomeReleaseReassertTests(unittest.TestCase):
    def _workflow(self, name: str) -> str:
        return (ROOT / ".forgejo" / "workflows" / name).read_text()

    def test_backend_reasserts_monotonic_image_after_chart_reconcile(self):
        workflow = self._workflow("deploy-backend.yml")
        self.assertIn("for attempt in 1 2 3", workflow)
        self.assertIn("kubectl set image -n shizuha deploy/shizuha-home-backend", workflow)
        self.assertLess(workflow.index("monotonic-release-guard.sh shizuha shizuha-home-backend"), workflow.index("for attempt in 1 2 3"))
        self.assertLess(workflow.index("for attempt in 1 2 3"), workflow.index('shizuha.io/last-successful-sha="${{ github.sha }}"'))

    def test_frontend_keeps_equivalent_reassert_contract(self):
        workflow = self._workflow("deploy-frontend.yml")
        self.assertIn("for attempt in 1 2 3", workflow)
        self.assertIn("kubectl set image -n shizuha deploy/shizuha-home-frontend", workflow)
        self.assertLess(workflow.index("monotonic-release-guard.sh shizuha shizuha-home-frontend"), workflow.index("for attempt in 1 2 3"))


if __name__ == "__main__":
    unittest.main()
