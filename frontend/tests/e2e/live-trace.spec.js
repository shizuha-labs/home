/**
 * Live-trace ingest + timeline. liveqa only.
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-trace.spec.js --project=chromium
 */
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome, bearerToken } from './live-operator.js'

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const CREDS = loadLiveQaCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1')
test.skip(!CREDS.user || !CREDS.pass, 'needs live-qa-creds')
test.skip(/hritik/i.test(CREDS.user), 'must not use the operator mailbox')

test.use({ viewport: { width: 1440, height: 900 } })

test('live-trace API and page show browser events for this user', async ({ page }) => {
  test.setTimeout(120000)
  await loginHome(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('home-live-button').click()
  await page.waitForTimeout(1200)
  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})

  await page.waitForTimeout(1500)
  const token = await bearerToken(page)
  const api = await page.request.get('/api/home/live-trace?include_messages=0&limit=80', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(api.ok(), `live-trace ${api.status()}`).toBeTruthy()
  const body = await api.json()
  expect(body.version).toBe(1)
  expect(Array.isArray(body.events)).toBe(true)
  const names = body.events.map((e) => e.name)
  expect(names.some((n) => n === 'session.start' || n === 'ui.click' || n === 'call.start' || n === 'call.begin')).toBe(true)

  await page.goto('/live-trace')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: /Voice \+ chat timeline/i })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('ol li').first()).toBeVisible({ timeout: 15000 })
})
