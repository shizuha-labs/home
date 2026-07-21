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
        assert "wait_job amd64 &" in workflow
        assert "wait_job arm64 &" in workflow
        assert not re.search(r"(?m)^\s*wait_job (?:amd64|arm64)$", workflow)
