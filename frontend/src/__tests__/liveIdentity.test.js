import { it as test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mod = await import('../../tests/e2e/live-identity.js')

test('QA credentials require the deployment-owned QA identity, never arbitrary file fallbacks', () => {
  const prior = { ...process.env }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-qa-config-'))
  try {
    process.env.SHIZUHA_LIVE_QA_EXPECTED_USER = 'qa-member'
    process.env.LIVE_QA_USER = 'someone-else'
    process.env.LIVE_QA_PASS = 'synthetic-fixture'
    process.env.SHIZUHA_LIVE_QA_CREDS = path.join(dir,'missing')
    assert.deepEqual(mod.loadLiveQaCreds(), {user:'',pass:''})
    process.env.LIVE_QA_USER = 'qa-member'
    assert.equal(mod.loadLiveQaCreds().user,'qa-member')
    delete process.env.LIVE_QA_USER
    delete process.env.LIVE_QA_PASS
    fs.writeFileSync(path.join(dir,'qa'),'qa-member\nsynthetic-fixture\n',{mode:0o600})
    process.env.SHIZUHA_LIVE_QA_CREDS = path.join(dir,'qa')
    assert.equal(mod.loadLiveQaCreds().user,'qa-member')
    process.env.SHIZUHA_LIVE_OPERATOR_E2E = '1'
    delete process.env.SHIZUHA_LIVE_AGENT
    assert.throws(() => mod.liveAgentUsername(), /Set SHIZUHA_LIVE_AGENT/)
    process.env.SHIZUHA_LIVE_AGENT = 'configured-agent'
    assert.equal(mod.liveAgentUsername(),'configured-agent')
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]
    Object.assign(process.env,prior)
    fs.rmSync(dir,{recursive:true,force:true})
  }
})

test('conversation target is explicit and no installation UUID is bundled', async () => {
  const previous = process.env.SHIZUHA_LIVE_THREAD
  try {
    delete process.env.SHIZUHA_LIVE_THREAD
    const noTarget = await import('../../tests/e2e/live-identity.js?empty-fixture')
    assert.equal(noTarget.KNOWN_THREAD,'')
    process.env.SHIZUHA_LIVE_THREAD = '00000000-0000-4000-8000-000000000001'
    const configured = await import('../../tests/e2e/live-identity.js?configured-fixture')
    assert.equal(configured.KNOWN_THREAD,process.env.SHIZUHA_LIVE_THREAD)
  } finally {
    if (previous === undefined) delete process.env.SHIZUHA_LIVE_THREAD
    else process.env.SHIZUHA_LIVE_THREAD = previous
  }
})
