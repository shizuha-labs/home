/**
 * Start Live on a thread with an hours-old last reply must stay silent.
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-no-replay-old-reply.spec.js --project=chromium
 *
 * liveqa → Ena QA only. Never the operator mailbox.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome, bearerToken, hudState } from './live-operator.js'
import { endLiveIfOpen, installSpokenMic, waitUntilListening } from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-no-replay-${process.pid}.json`)
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
    args: [
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
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

test('Start Live does not speak an hours-old last reply', async ({ page }) => {
  test.setTimeout(120000)
  await installSpokenMic(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const thread = page.getByRole('button', { name: /Ena QA/i }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  const liveBtn = page.getByTestId('thread-live-button')
  await expect(liveBtn).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('connect-message-list')).toBeVisible({ timeout: 20000 })

  const token = await bearerToken(page)
  const conversationId = page.url().match(/\/c\/([^/?#]+)/)?.[1] || ''
  expect(conversationId, 'opened Ena QA thread').toBeTruthy()
  const msgs = await page.request.get(`/connect/api/conversations/${conversationId}/messages/?limit=8`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(msgs.ok(), `messages ${msgs.status()}`).toBeTruthy()
  const msgBody = await msgs.json()
  const list = msgBody.results || msgBody.messages || msgBody || []
  const last = Array.isArray(list) ? list[list.length - 1] : null
  const ageMs = last?.created_at ? Date.now() - Date.parse(last.created_at) : Infinity
  if (Number.isFinite(ageMs) && ageMs < 21_000) {
    await page.waitForTimeout(21_000 - ageMs + 500)
  }

  const started = Date.now()
  await liveBtn.click()
  await expect(page.getByTestId('live-voice-overlay')).toBeVisible({ timeout: 20000 })
  await waitUntilListening(page, 20000).catch(() => {})
  await page.waitForTimeout(3500)

  const states = []
  for (let i = 0; i < 6; i += 1) {
    states.push((await hudState(page)).state)
    await page.waitForTimeout(250)
  }

  await page.waitForTimeout(1500)
  const api = await page.request.get(
    `/api/home/live-trace?include_messages=0&limit=120&conversation_id=${conversationId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(api.ok(), `live-trace ${api.status()}`).toBeTruthy()
  const body = await api.json()
  const events = (body.events || []).filter((e) => Date.parse(e.ts || '') >= started - 2000)
  const names = events.map((e) => e.name)
  const leftover = events.filter((e) => e.name === 'chat.persist' || e.name === 'tts.speak.begin')
  const spokeWithoutTurn = leftover.filter((e) => {
    const before = events.filter((x) => Date.parse(x.ts) <= Date.parse(e.ts))
    return !before.some((x) => x.name === 'stt.final' || x.name === 'chat.send' || x.name === 'chat.stream')
  })

  expect(names, `trace names: ${names.join(',')}`).toContain('chat.persist.prime')
  expect(spokeWithoutTurn, `unexpected leftover speak: ${JSON.stringify(spokeWithoutTurn)}`).toEqual([])
  expect(states.some((s) => s === 'speaking'), `HUD spoke leftover: ${states.join(',')}`).toBe(false)
})
