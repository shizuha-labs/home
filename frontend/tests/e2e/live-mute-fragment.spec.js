/**
 * HUD mute must not send a fragment like "I'm".
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-mute-fragment.spec.js --project=chromium
 *
 * liveqa → Ena QA only.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome, bearerToken } from './live-operator.js'
import {
  endLiveIfOpen,
  installSpokenMic,
  miniChatTurns,
  startSpokenLive,
  speakAsHuman,
  waitUntilListening,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-mute-frag-${process.pid}.json`)
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

test('HUD mute discards I\'m and does not post it', async ({ page }) => {
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
  const before = await miniChatTurns(page)

  await speakAsHuman(page, "I'm")
  const mute = page.getByTestId('hud-mute-button')
  await expect(mute).toBeVisible()
  await mute.click()
  await expect(page.getByTestId('live-voice-state')).toHaveText(/Muted/i, { timeout: 5000 })
  await page.waitForTimeout(4500)

  const after = await miniChatTurns(page)
  const added = after.filter((row) => (
    row.role === 'user' && /^i['’]?m[.!?]?$/i.test(row.text.trim())
    && !before.some((b) => b.role === 'user' && b.text === row.text)
  ))
  expect(added, `muted fragment leaked: ${JSON.stringify(added)}`).toEqual([])

  const token = await bearerToken(page)
  const api = await page.request.get('/api/home/live-trace?include_messages=0&limit=80', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(api.ok()).toBeTruthy()
  const names = ((await api.json()).events || []).map((e) => e.name)
  expect(names).toContain('mic.mute')
})
