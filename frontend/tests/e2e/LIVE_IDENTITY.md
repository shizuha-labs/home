# Explicit live QA configuration

Live tests require credentials supplied through the dedicated QA environment or
`SHIZUHA_LIVE_QA_CREDS`; they never fall back to an operator credential file.
`SHIZUHA_LIVE_QA_EXPECTED_USER` selects the dedicated unprivileged QA account
(default `liveqa`). Other identities are refused before browser login.

Set `SHIZUHA_LIVE_QA_AGENT` to the installation's QA agent and
`SHIZUHA_LIVE_THREAD` to the reviewed conversation used by thread-specific tests.
No private conversation UUID is bundled. The generic `qa-agent` placeholder is
not a promise that an installation has provisioned that account.

Operator tests require `SHIZUHA_LIVE_OPERATOR_E2E=1`, explicit operator
credentials and `SHIZUHA_LIVE_AGENT`. Prefer `SHIZUHA_LIVE_OPERATOR_USER` and
`SHIZUHA_LIVE_OPERATOR_PASS`; old environment key aliases remain accepted only
inside this explicitly opted-in path. Never commit identities or credential
values into source fixtures, logs or screenshots.
