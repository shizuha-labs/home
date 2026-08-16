/**
 * Operator-facing homepage Live QA. This is the journey that shipped
 * half-baked when only unit tests passed:
 *
 *   login → / → start Live → type a turn → see Ena's reply
 *        → no "Replied." / Keyterms ghosts
 *        → HUD does not freeze on Speaking
 *        → mini-chat scrolls
 *        → Open full chat / Dashboard keep the HUD
 *
 * Run against production:
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     HRITIK_USER=… HRITIK_PASS=… \
 *     npx playwright test tests/e2e/live-homepage-talk.spec.js
 */
import { test, expect } from '@playwright/test'

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const USER = process.env.HRITIK_USER || process.env.E2E_USERNAME || process.env.AGENT_USERNAME
const PASS = process.env.HRITIK_PASS || process.env.E2E_PASSWORD || process.env.AGENT_PASSWORD

test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1 to run operator live homepage talk QA')
test.skip(!USER || !PASS, 'live homepage talk QA needs HRITIK_USER/HRITIK_PASS (or E2E_*)')

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

test.describe.configure({ mode: 'serial' })

async function loginHome(page) {
  await page.goto('/id/login?continue=/')
  await page.waitForSelector('input[type="password"]', { timeout: 20000 })
  const inputs = page.locator('form input')
  const n = await inputs.count()
  for (let i = 0; i < n; i += 1) {
    const type = await inputs.nth(i).getAttribute('type')
    if (type === 'password') await inputs.nth(i).fill(PASS)
    else if (type !== 'hidden' && type !== 'submit') await inputs.nth(i).fill(USER)
  }
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/id/api/auth/login/') && r.request().method() === 'POST', { timeout: 30000 }),
    page.locator('button[type="submit"], input[type="submit"]').first().click(),
  ])
  await page.waitForURL((url) => !url.toString().includes('/id/login'), { timeout: 30000 })
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: /Shizuha/i }).first()).toBeVisible({ timeout: 20000 })
}

function ghostLocator(page) {
  return page.getByText(/^(Replied\.?|Keyterms?:)/i)
}

test('homepage Live: reply is audible-ready, no ghosts, strip scrolls, SPA keeps HUD', async ({ page }) => {
  test.setTimeout(120000)
  await loginHome(page)

  const liveBtn = page.getByTestId('home-live-button').or(page.getByRole('button', { name: /Start Live/i })).first()
  await expect(liveBtn).toBeVisible({ timeout: 20000 })
  await liveBtn.click()

  const hud = page.getByTestId('live-voice-overlay')
  await expect(hud).toBeVisible({ timeout: 20000 })
  await expect(hud).toHaveAttribute('data-mode', 'hud')
  await expect(page.getByText(/Your organization is working/i)).toBeVisible()

  const box = page.locator('textarea').first()
  await box.click()
  const probe = `live qa ${Date.now()}: say hello in one short sentence`
  await box.fill(probe)
  await page.keyboard.press('Enter')

  const strip = page.getByTestId('mini-chat-scroll')
  await expect(strip).toBeVisible({ timeout: 20000 })
  await expect(strip).toContainText(probe, { timeout: 15000 })

  await expect(strip.getByText(/hey|here|hello|hi\b/i).first()).toBeVisible({ timeout: 25000 })
  await expect(strip.getByText(/^Replied\.?$/i)).toHaveCount(0)
  await expect(page.getByText(/^Keyterms?:/i)).toHaveCount(0)

  const speakingStarted = Date.now()
  let speakingMs = 0
  for (let i = 0; i < 24; i += 1) {
    const label = ((await page.locator('text=/Speaking/i').first().textContent().catch(() => '')) || '')
    if (/speaking/i.test(label)) speakingMs = Date.now() - speakingStarted
    else if (speakingMs > 0) break
    await page.waitForTimeout(500)
  }
  expect(speakingMs, 'HUD must leave Speaking so TTS/listen can resume').toBeLessThan(15000)
  await expect(page.getByText(/Listening|Thinking|Live/i).first()).toBeVisible({ timeout: 15000 })

  const scroll = await strip.evaluate((el) => {
    const before = el.scrollTop
    el.scrollTop = 0
    const atTop = el.scrollTop
    el.scrollTop = el.scrollHeight
    return {
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      moved: el.scrollTop !== atTop || el.scrollHeight > el.clientHeight + 4,
      before,
    }
  })
  expect(scroll.overflowY).toMatch(/auto|scroll/)
  if (scroll.scrollHeight > scroll.clientHeight + 4) {
    expect(scroll.moved).toBeTruthy()
  }

  const pageScroller = page.locator('.overflow-y-auto').first()
  const pageCanScroll = await pageScroller.evaluate((el) => el.scrollHeight > el.clientHeight + 8)
  expect(pageCanScroll, 'homepage under the compose strip must still scroll').toBeTruthy()

  const openFull = page.getByRole('button', { name: /Open full chat/i })
  await expect(openFull).toBeVisible()
  await openFull.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  await expect(hud).toBeVisible()
  await expect(page.getByTestId('thread-live-button')).toBeVisible()
  await expect(page.getByText(/^Replied\.?$/i)).toHaveCount(0)

  const threadId = page.url().split('/c/')[1]?.split(/[?#]/)[0]
  expect(threadId).toBeTruthy()
  const replied = await page.request.post(`/connect/api/conversations/${threadId}/messages/`, {
    data: { content: 'Replied.' },
  })
  expect(replied.status(), 'conversation POST Replied. must 400').toBe(400)

  await page.getByRole('link', { name: /^Dashboard$/ }).first().click()
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 })
  await expect(hud).toBeVisible()
  await expect(ghostLocator(page)).toHaveCount(0)

  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})
})
