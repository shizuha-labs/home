# Frontend dependency and source contract

The frontend test Job and production builder preserve the same nested layout:
`/workspace/home/frontend` and `/workspace/packages/{shizuha-ui,shizuha-chat}`.
The frontend lock records `../../packages` links. Flattening the app to `/app`
changes their normalized location and breaks npm's virtual lock loading. Removing
the lock then re-resolves optional peers and has reproduced an npm 10 peer-set
crash before tests are discovered. Preserve the layout and reviewed locks; use
`npm ci` for all three projects. Do not delete locks or bypass peer validation.

`HOME_FRONTEND_PACKAGES_COMMIT` pins the shared-package source for both native
tests and multi-architecture builds. Advance it only after the exact package
locks pass clean installs and the same source cohort passes the full frontend
suite and production build. The Job records both source commits. It archives only
the tracked shared packages and frontend into a fresh directory; the test
container mounts that directory as a subPath, excluding clone credentials,
ancestor package manifests and unrelated infrastructure source.

The quality gate runs `.forgejo/scripts/test-frontend-locked-context.py`, which
executes the native archive commands with real disposable Git repositories. It
checks exact revisions, retained locks/tests, untracked-file exclusion and refusal
to overwrite an existing context. The Kaniko guard retains the exact-ref,
premerge exclusion, previous-assets and bounded cache-retry contracts.
