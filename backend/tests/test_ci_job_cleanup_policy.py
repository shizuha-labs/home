import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_active_workflow_jobs_expire_and_builds_clean_up():
    for name in ("deploy-backend.yml", "deploy-frontend.yml"):
        workflow = (ROOT / ".forgejo/workflows" / name).read_text()
        ttls = [
            int(value)
            for value in re.findall(r"ttlSecondsAfterFinished:\s*(\d+)", workflow)
        ]
        assert workflow.count("kind: Job") == len(ttls)
        assert ttls
        assert all(ttl <= 300 for ttl in ttls)
        assert workflow.count("- --cleanup") == workflow.count(
            "image: gcr.io/kaniko-project/executor:v1.23.2"
        )
        # Both workflow implementations must run the architecture builds in
        # parallel. The frontend's bounded-retry wrapper is named build_arch;
        # the backend directly backgrounds wait_job.
        assert re.search(r"(?m)^\s*(?:wait_job|build_arch) amd64 &$", workflow)
        assert re.search(r"(?m)^\s*(?:wait_job|build_arch) arm64 &$", workflow)
        assert not re.search(
            r"(?m)^\s*(?:wait_job|build_arch) (?:amd64|arm64)$", workflow
        )
