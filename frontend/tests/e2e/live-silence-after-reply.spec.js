/**
 * After she answers, saying nothing must not invent a user turn.
 * This is the "What can I do?" class — TTS leak posted as the caller.
 *
 *   npm run test:e2e:live:qa
 *
 * liveqa → Ena QA only. Never the operator mailbox.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome, bearerToken } from './live-operator.js'
import {
  assertNoPhantomUserTurns,
  endLiveIfOpen,
  installSpokenMic,
  miniChatTurns,
  spokenTurn,
  startSpokenLive,
  waitHudLeavesSpeaking,
  waitUntilListening,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-silence-${process.pid}.json`)
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
}

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const CREDS = loadLiveQaCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1')
test.skip(!CREDS.user || !CREDS.pass, 'needs live-qa-creds')
test.skip(/hritik/i.test(CREDS.user), 'must not use the operator mailbox')

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
  storageState: STATE,
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  },
})

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  await loginHome(page)
  await context.storageState({ path: STATE })
  await context.close()
})

test.afterEach(async ({ page }) => {
  await endLiveIfOpen(page)
})

test('silence after her reply does not invent a user turn', async ({ page }) => {
  test.setTimeout(180000)
  await installSpokenMic(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const thread = page.getByRole('button', { name: /Ena QA/i }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  await startSpokenLive(page)
  await waitUntilListening(page, 20000)

  const marker = `silence-check ${Date.now() % 10000}`
  await spokenTurn(page, {
    name: 'silence-greet',
    script: `Hey Ena, you there? ${marker}. What's up?`,
    hear: /hey|ena|what's up|whats up|silence-check/i,
    agentTimeout: 90000,
    allowShortAgent: true,
  })
  await waitHudLeavesSpeaking(page, 40000)
  await waitUntilListening(page, 20000)

  const afterReply = await miniChatTurns(page)
  await assertNoPhantomUserTurns(page, afterReply, 8000)

  const token = await bearerToken(page)
  const api = await page.request.get('/api/home/live-trace?include_messages=0&limit=80', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(api.ok()).toBeTruthy()
  const events = (await api.json()).events || []
  const lastSpeak = [...events].reverse().find((e) => e.name === 'tts.speak.begin' || e.name === 'chat.persist')
  const afterSpeak = lastSpeak
    ? events.filter((e) => Date.parse(e.ts) >= Date.parse(lastSpeak.ts))
    : []
  const invented = afterSpeak.filter((e) => {
    if (e.name !== 'stt.final' && e.name !== 'chat.send') return false
    const text = String(e.attrs?.text || '')
    return !/silence-check|hey ena|what's up|whats up/i.test(text)
  })
  expect(invented, `unexpected send after her reply: ${JSON.stringify(invented)}`).toEqual([])
})
