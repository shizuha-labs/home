import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const wf = await readFile(new URL('../../.forgejo/workflows/deploy-frontend.yml', import.meta.url), 'utf8')
const smoke = await readFile(new URL('./publicPageerrorSmoke.mjs', import.meta.url), 'utf8')

assert.match(wf, /needs:\s*\[quality,\s*test\]/)
assert.match(wf, /node scripts\/loggedOutAuth\.guardrail\.test\.mjs/)
assert.match(wf, /node scripts\/deployFrontendGate\.guardrail\.test\.mjs/)
assert.match(wf, /trap cleanup EXIT/)
assert.match(wf, /PROMOTED=0/)
assert.match(wf, /ROLLED=0/)
assert.match(wf, /ci-preview-home-frontend/)
assert.match(wf, /run_pageerror_smoke/)
assert.match(wf, /run_pageerror_smoke "https:\/\/shizuha\.com"/)
assert.match(wf, /page\.on\('pageerror'/)
assert.match(wf, /chromium\.launch/)
assert.match(wf, /node \/tmp\/smoke\.mjs/)
assert.match(wf, /last-successful-sha/)
assert.match(wf, /cat > \/tmp\/publicPageerrorSmoke\.mjs << 'SMOKE_EOF'/)
assert.doesNotMatch(wf, /find .*publicPageerrorSmoke/)
assert.doesNotMatch(wf, /publicPageerrorSmoke\.mjs \| head/)
assert.ok(smoke.includes("page.on('pageerror'"), 'smoke must subscribe to pageerror')
assert.ok(smoke.includes('chromium.launch'), 'smoke must launch a real browser')
assert.ok(wf.includes("page.on('pageerror'"), 'workflow must inline the smoke script')
const roll = wf.indexOf('frontend="localhost:30500/shizuha-home-frontend:${FTAG}"')
assert.ok(roll > 0, 'prod set-image of the new tag must exist')
assert.ok(
  wf.indexOf('run_pageerror_smoke "http://') > 0 && wf.indexOf('run_pageerror_smoke "http://') < roll,
  'preview pageerror smoke must run before the prod set-image',
)
assert.ok(
  wf.indexOf('run_pageerror_smoke "https://shizuha.com"') > roll,
  'live pageerror smoke must run after the prod roll',
)
console.log('deploy frontend fail-prod gate: ok')
