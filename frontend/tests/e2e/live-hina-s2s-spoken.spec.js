/**
 * Spoken Hina S2S QA. The router-only check (HUD chip + socket URL) is
 * not enough: Hina must HEAR the caller and SPEAK back.
 *
 *   SHIZUHA_LIVE_OPERATOR_E2E=1 SHIZUHA_LIVE_SPOKEN_E2E=1 \
 *     npx playwright test tests/e2e/live-hina-s2s-spoken.spec.js --project=chromium
 *
 * Operator creds only (Hina is CEO Office). Never print the password.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  loadOperatorCreds,
  loginHome,
  selectHomeAgent,
  shot,
  hudState,
} from './live-operator.js'
import {
  installSpokenMic,
  speakLikeHuman,
  waitUntilListening,
  hudCaption,
  endLiveIfOpen,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-hina-s2s-${process.pid}.json`)
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
}

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1' || process.env.SHIZUHA_LIVE_SPOKEN_E2E === '1'
const OPERATOR = process.env.SHIZUHA_LIVE_OPERATOR_E2E === '1'
const CREDS = loadOperatorCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_SPOKEN_E2E=1 to run Hina spoken S2S QA')
test.skip(!OPERATOR, 'Hina spoken S2S QA is operator-vantage only')
test.skip(!CREDS.user || !CREDS.pass, 'needs ~/.shizuha/operator-ui-creds')

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  storageState: STATE,
})

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  process.env.SHIZUHA_LIVE_OPERATOR_E2E = '1'
  await loginHome(page)
  await context.storageState({ path: STATE })
  await context.close()
})

test.afterAll(() => {
  try { fs.unlinkSync(STATE) } catch { /* tmp */ }
})

test('Hina Live is native Voice and she answers a spoken turn with audio', async ({ page }) => {
  await installSpokenMic(page)
  await page.goto('/')
  await selectHomeAgent(page, 'hina')
  if (page.url().includes('/c/')) {
    await page.goto('/')
    await page.waitForSelector('[data-testid="home-live-button"]', { timeout: 20000 })
  }
  const liveBtn = page.getByTestId('home-live-button')
  await expect(liveBtn).toHaveAttribute('data-live-path', 's2s', { timeout: 20000 })
  await expect(liveBtn).toHaveAttribute('data-live-agent', 'hina')

  const sockets = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await liveBtn.click({ force: true })
  const hud = page.getByTestId('live-voice-overlay')
  await expect(hud).toBeVisible({ timeout: 20000 })
  await expect(hud).toHaveAttribute('data-transport', 's2s')
  await expect.poll(() => sockets.some((u) => u.includes('/voice/api/realtime/stream'))).toBeTruthy()
  expect(sockets.some((u) => u.includes('/voice/api/stt/stream'))).toBeFalsy()
  await waitUntilListening(page, 20000)
  await shot(page, 'hina-s2s-listening')

  const mutedAfterStart = await page.evaluate(() => window.__shizuhaSpeakOutput?.()?.muted)
  expect(mutedAfterStart, 'speaker must not stay latched muted after Live start').toBe(false)

  await speakLikeHuman(page, 'Hey Hina, say your name in one short sentence.')
  const deadline = Date.now() + 45000
  let heard = ''
  let spoke = false
  let remaining = 0
  let speakerMuted = true
  while (Date.now() < deadline) {
    const now = await hudState(page)
    heard = await hudCaption(page)
    remaining = await page.evaluate(() => window.__shizuhaSpeakOutput?.()?.remainingMs || 0)
    speakerMuted = await page.evaluate(() => window.__shizuhaSpeakOutput?.()?.muted === true)
    if (now.state === 'speaking' || remaining > 80 || /hina/i.test(heard)) {
      spoke = true
      break
    }
    await page.waitForTimeout(300)
  }
  await shot(page, 'hina-s2s-after-speak')
  expect(spoke, `Hina never spoke back. hud=${heard}`).toBeTruthy()
  expect(speakerMuted, 'speaker was still latched muted while she should talk').toBeFalsy()

  const trace = await page.request.get('/api/home/live-trace?include_messages=0&limit=80')
  expect(trace.ok()).toBeTruthy()
  const body = await trace.json()
  const names = (body.events || body.items || []).map((row) => row.name || row.event || '')
  expect(names.some((n) => n === 's2s.user' || n === 's2s.assistant' || n === 's2s.audio_unmute' || n === 's2s.ready')).toBeTruthy()
  expect(names.includes('s2s.audio_drop')).toBeFalsy()

  await endLiveIfOpen(page)
})
