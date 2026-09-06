/**
 * Live: Voice replies off must cut whatever she is already saying.
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-voice-replies-off.spec.js --project=chromium
 *
 * Uses liveqa → Ena QA. Never the operator mailbox.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome } from './live-operator.js'
import {
  installSpokenMic,
  startSpokenLive,
  speakAsHuman,
  spokenTurn,
  endLiveIfOpen,
  waitUntilListening,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-voice-off-${process.pid}.json`)
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
}

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const CREDS = loadLiveQaCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1 to run Voice replies off against production')
test.skip(!CREDS.user || !CREDS.pass, 'needs ~/.shizuha/live-qa-creds')
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

test('Voice replies off cuts in-flight TTS immediately', async ({ page }) => {
  test.setTimeout(4 * 60 * 1000)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await installSpokenMic(page)
  await startSpokenLive(page)
  await waitUntilListening(page, 20000)

  await spokenTurn(page, {
    name: 'warm-lantern',
    script: 'Please tell me a short two sentence story about a lantern.',
    hear: /lantern|story|sentence/i,
    topic: /lantern|porch|flame|wick|night/i,
    agentTimeout: 90000,
  })

  await speakAsHuman(
    page,
    'Now count slowly from one to thirty. Say every number. Do not skip.',
    { pauseMsAfter: 500 },
  )

  const deadline = Date.now() + 90000
  let hud = ''
  while (Date.now() < deadline) {
    hud = (await page.getByTestId('live-voice-state').innerText().catch(() => '')) || ''
    if (/Speaking/i.test(hud)) break
    await page.waitForTimeout(50)
  }

  const speak = page.getByTestId('hud-speak-button')
    .or(page.getByTestId('thread-speak-button'))
    .or(page.getByTestId('mini-speak-button'))
    .first()
  await expect(speak).toBeVisible({ timeout: 10000 })
  await expect(speak).toHaveAttribute('aria-pressed', 'true')
  await speak.click({ force: true })
  await expect(speak).toHaveAttribute('aria-pressed', 'false')
  await expect(speak).toHaveAttribute('title', 'Voice replies off')

  const output = await page.evaluate(() => window.__shizuhaSpeakOutput?.() || null)
  expect(output, 'deployed bundle exposes speak-output probe').toBeTruthy()
  expect(output.muted, `hud was ${hud}`).toBe(true)
  expect(output.remainingMs).toBe(0)

  await page.waitForTimeout(1500)
  const later = await page.evaluate(() => window.__shizuhaSpeakOutput?.() || null)
  expect(later.muted).toBe(true)
  expect(later.remainingMs).toBe(0)
  await expect(page.getByTestId('live-voice-state')).not.toHaveText(/Speaking/i)
})
