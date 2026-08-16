#!/usr/bin/env python3
"""Source contract for Home's exact-ref, bounded Kaniko EOF recovery."""

from pathlib import Path


WORKFLOW = Path(__file__).parents[1] / "workflows" / "deploy-frontend.yml"
SOURCE = WORKFLOW.read_text()


def require(fragment: str) -> None:
    if fragment not in SOURCE:
        raise AssertionError(f"missing deploy-frontend contract fragment: {fragment!r}")


def main() -> None:
    require("pull_request:")
    require("if: github.event_name != 'pull_request'")
    require("needs: contract")
    require("test \"\\$(git rev-parse HEAD)\" = \"${{ github.sha }}\"")

    require('render_build_job "${ARCH}" 1 true')
    require('render_build_job "${ARCH}" 2 false')
    require('render_build_job "${ARCH}" 1 true | kubectl apply -f -')
    require('render_build_job "${ARCH}" 2 false | kubectl apply -f -')
    require("failed to get filesystem from image: unexpected EOF")
    require("npm error code ETIMEDOUT")
    require("retrying once with cache disabled")
    require("cache-disabled retry failed")
    require("--cache=${CACHE_ENABLED}")
    require("--cache-copy-layers=${CACHE_ENABLED}")
    require("--build-arg=PREV_FRONTEND_IMAGE=${PREV_FRONTEND_IMAGE}")
    require("Carry forward hashed assets from")

    if SOURCE.count('render_build_job "${ARCH}" 2 false') != 1:
        raise AssertionError("cache bypass must be exactly one bounded retry")
    if "building default HEAD" in SOURCE:
        raise AssertionError("workflow must never fall back to an unanchored default HEAD")

    print("OK — exact-ref checkout and one cache-disabled EOF retry are enforced")


if __name__ == "__main__":
    main()
