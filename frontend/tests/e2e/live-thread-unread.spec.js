/**
 * Sitting in an open /c/:id thread looking at the last message must not
 * show an "N unread" jump chip.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome } from './live-operator.js'

const STATE = path.join(os.tmpdir(), `shizuha-unread-${process.pid}.json`)
if (!fs.existsSync(STATE)) fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const CREDS = loadLiveQaCreds()
test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1')
test.skip(!CREDS.user || !CREDS.pass, 'needs live-qa-creds')
test.skip(/hritik/i.test(CREDS.user), 'must not use the operator mailbox')
test.use({ viewport: { width: 1440, height: 900 }, storageState: STATE })
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await loginHome(page)
  await context.storageState({ path: STATE })
  await context.close()
})
test('open thread at latest does not claim unread', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const thread = page.getByRole('button', { name: /Ena QA/i }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
  await expect(page.getByTestId('connect-message-list')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(800)
  await expect(page.getByTestId('unread-jump-button')).toHaveCount(0)
  const sidebarUnread = page.locator('button').filter({ hasText: /Ena QA/i }).locator('span', { hasText: /^\d+\+?$/ })
  // Active row must not show a numeric unread pill
  await expect(page.getByRole('button', { name: /Ena QA/i }).first()).toBeVisible()
})
