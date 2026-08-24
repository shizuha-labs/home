/**
 * Full /c/:id compose send must work even if the Connect socket is flaky.
 * Homepage send already used REST fallback; the thread input used to disable.
 *
 *   SHIZUHA_LIVE_E2E=1 BASE_URL=https://shizuha.com \
 *     npx playwright test tests/e2e/live-thread-send.spec.js --project=chromium
 *
 * liveqa → Ena QA only.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome } from './live-operator.js'

const STATE = path.join(os.tmpdir(), `shizuha-thread-send-${process.pid}.json`)
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
  storageState: STATE,
})

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await loginHome(page)
  await context.storageState({ path: STATE })
  await context.close()
})

test('full thread send posts a typed message', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const thread = page.getByRole('button', { name: /Ena QA/i }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  const box = page.getByRole('textbox', { name: /Message/i }).first()
  await expect(box).toBeVisible({ timeout: 15000 })
  await expect(box).toBeEnabled()
  const marker = `thread-send ${Date.now()}`
  await box.fill(marker)
  const send = page.getByTestId('thread-send-button').or(page.getByRole('button', { name: 'Send message' }))
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByTestId('connect-message-list')).toContainText(marker, { timeout: 20000 })
})
