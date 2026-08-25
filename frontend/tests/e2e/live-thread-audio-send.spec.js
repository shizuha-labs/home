/**
 * Live audio on the full /c/:id thread must post the utterance.
 * Homepage Live already sent; the expanded Connect thread used to drop it.
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-thread-audio-send.spec.js --project=chromium
 *
 * liveqa → Ena QA only.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome } from './live-operator.js'
import {
  endLiveIfOpen,
  installSpokenMic,
  miniChatTurns,
  startSpokenLive,
  speakAsHuman,
  waitForNewUserTurn,
  waitUntilListening,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-thread-audio-${process.pid}.json`)
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

test('full thread Live audio send posts the spoken turn', async ({ page }) => {
  test.setTimeout(180000)
  await installSpokenMic(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const thread = page.getByRole('button', { name: /Ena QA/i }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  await expect(page.getByTestId('thread-send-button').or(page.getByRole('button', { name: 'Send message' }))).toBeVisible({ timeout: 15000 })
  await startSpokenLive(page)
  await waitUntilListening(page, 20000)
  const before = await miniChatTurns(page)
  const marker = `thread audio ${Date.now() % 100000}`
  await speakAsHuman(page, marker)
  const heard = await waitForNewUserTurn(page, before, /thread audio/i, 35000)
  expect(heard.turn.text, 'spoken turn must land on the open /c/:id thread').toMatch(/thread audio/i)
})
