/**
 * Operator-facing homepage Live QA. This is the journey that shipped
 * half-baked when only unit tests passed:
 *
 *   login → / → start Live → type a turn (the "what's up" class)
 *        → the typed turn is visible
 *        → agent reply is a real sentence, not "Replied." / Keyterms
 *        → HUD does not freeze on Speaking
 *        → mini-chat scrolls
 *        → Open full chat / Dashboard keep the same HUD (SPA)
 *        → thread has the same Live / mic / speak chrome
 *        → Connect rejects ack-only "Replied."
 *
 * Run against production before shipping home Live/voice:
 *   npm run test:e2e:live
 *
 * Credentials: HRITIK_USER/HRITIK_PASS, or ~/.shizuha/operator-ui-creds.
 * Never commit or print the password.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  KNOWN_THREAD,
  loadOperatorCreds,
  loginHome,
  authHeaders,
  shot,
  assertNoGhosts,
  assertSidebarHasNoGhosts,
  hudState,
  waitHudLeavesSpeaking,
  sendHomeCompose,
  homeCompose,
  homeMainScroll,
  visibleTalkText,
} from './live-operator.js'

const STATE = path.join(os.tmpdir(), `shizuha-live-qa-${process.pid}.json`)
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
}

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1'
const CREDS = loadOperatorCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_E2E=1 to run operator live homepage talk QA')
test.skip(!CREDS.user || !CREDS.pass, 'live homepage talk QA needs operator creds')

test.use({
  viewport: { width: 1440, height: 900 },
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

test.afterAll(() => {
  try { fs.unlinkSync(STATE) } catch { /* tmp */ }
})

test.use({ storageState: STATE })

async function waitForNewAgentReply(page, probe, timeout = 60000) {
  const strip = page.getByTestId('mini-chat-scroll')
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    const text = (await strip.innerText().catch(() => '')) || (await visibleTalkText(page))
    last = text
    const idx = text.indexOf(probe)
    if (idx >= 0) {
      const after = text.slice(idx + probe.length)
      const lines = after.split('\n').map((s) => s.trim()).filter(Boolean)
      const reply = lines.find((line) => (
        line
        && line !== probe
        && !line.startsWith('live-qa ')
        && !/^(replied\.?|keyterms?\s*:)/i.test(line)
        && line.length >= 8
      ))
      if (reply) return { reply, text }
    }
    await page.waitForTimeout(500)
  }
  throw new Error(
    `typed turn must stay visible and get a real reply. probe=${probe}\nlast visible:\n${last.slice(-1200)}`,
  )
}

test('operator homepage Live: typed turn, no ghosts, HUD unsticks, strip scrolls, SPA keeps HUD', async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('home-live-button')).toBeVisible({ timeout: 20000 })
  await shot(page, '01-home-after-login')

  await test.step('dashboard is the logged-in ChatHome, not a remounted landing page', async () => {
    await expect(page.getByTestId('home-live-button')).toBeVisible()
    await expect(homeCompose(page)).toBeVisible()
    await expect(page.getByText(/Good (morning|afternoon|evening)/i).first()).toBeVisible()
    await expect(page.locator('a[href="/id/login"]')).toHaveCount(0)
  })

  await test.step('Start Live keeps the dashboard visible under the HUD', async () => {
    await page.getByTestId('home-live-button').click()
    const hud = page.getByTestId('live-voice-overlay')
    await expect(hud).toBeVisible({ timeout: 20000 })
    await expect(hud).toHaveAttribute('data-mode', 'hud')
    const state = await hudState(page)
    expect(state.present).toBeTruthy()
    expect(state.state, `Live HUD state after start: ${state.state} ${state.label}`).not.toBe('idle')
    if (state.state === 'error') {
      const err = await page.getByTestId('voice-call-error').textContent().catch(() => state.label)
      throw new Error(`Live failed to start: ${err || 'unknown voice error'}`)
    }
    await expect(page.getByRole('heading', { name: /Shizuha/i }).first()).toBeVisible()
    await expect(homeCompose(page)).toBeVisible()
    await hud.evaluate((el) => { el.dataset.qaKeep = '1' })
    await shot(page, '02-live-hud-on-home')
  })

  const probe = `live-qa ${Date.now()}: say the word tangerine in one short sentence`
  await test.step('typed turn is visible in the homepage strip (the missing what\'s-up class)', async () => {
    await sendHomeCompose(page, probe)
    const strip = page.getByTestId('mini-chat-scroll')
    await expect(strip).toBeVisible({ timeout: 20000 })
    await expect(strip).toContainText(probe, { timeout: 20000 })
    await shot(page, '03-probe-in-mini-chat')
  })

  let reply = ''
  await test.step('agent reply is a real sentence, not Replied. or Keyterms', async () => {
    const found = await waitForNewAgentReply(page, probe, 70000)
    reply = found.reply
    expect(found.text, 'typed turn vanished from the strip after send (the missing what\'s-up class)').toContain(probe)
    expect(reply.length, `agent reply too short: ${reply}`).toBeGreaterThan(7)
    expect(reply, 'ack-only leftover').not.toMatch(/^(replied|done|sent|ok|noted)[.!]?$/i)
    expect(reply, 'STT keyterm dump').not.toMatch(/^keyterms?\s*:/i)
    await expect(page.getByTestId('mini-chat-scroll')).toContainText(probe)
    await assertNoGhosts(page, 'mini-chat after first reply')
    await shot(page, '04-agent-reply')
  })

  await test.step('HUD leaves Speaking so listen can resume', async () => {
    const after = await waitHudLeavesSpeaking(page, 20000)
    expect(after.stuck).toBeFalsy()
    expect(['listening', 'thinking', 'connecting', 'speaking'].includes(after.state) || after.state === '',
      `HUD ended in unexpected state ${after.state}`).toBeTruthy()
    const live = await hudState(page)
    expect(live.state).not.toBe('speaking')
    await shot(page, '05-hud-after-speak')
  })

  await test.step('mini-chat and homepage both scroll', async () => {
    const strip = page.getByTestId('mini-chat-scroll')
    const stripScroll = await strip.evaluate((el) => {
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
    expect(stripScroll.overflowY).toMatch(/auto|scroll/)
    expect(stripScroll.scrollHeight, 'mini-chat must keep more than a 3-line clip').toBeGreaterThan(40)
    if (stripScroll.scrollHeight > stripScroll.clientHeight + 4) {
      expect(stripScroll.moved).toBeTruthy()
    }

    const main = homeMainScroll(page)
    await expect(main).toBeVisible()
    const mainScroll = await main.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(mainScroll.overflowY).toMatch(/auto|scroll/)
    expect(mainScroll.scrollHeight, 'homepage under the compose strip must still scroll').toBeGreaterThan(mainScroll.clientHeight + 8)
  })

  let threadId = ''
  await test.step('Open full chat keeps the same HUD and shows thread Live chrome', async () => {
    const hud = page.getByTestId('live-voice-overlay')
    await page.getByRole('button', { name: /Open full chat/i }).click()
    await page.waitForURL(/\/c\//, { timeout: 15000 })
    await expect(hud).toBeVisible()
    await expect(hud).toHaveAttribute('data-qa-keep', '1')
    await expect(hud).toHaveAttribute('data-mode', 'hud')
    await expect(page.getByTestId('thread-live-button')).toBeVisible()
    await expect(page.getByTestId('thread-speak-button')).toBeVisible()
    await expect(page.getByTestId('thread-mic-button')).toBeVisible()
    await expect(page.getByTestId('connect-message-list')).toContainText(probe, { timeout: 20000 })
    await assertNoGhosts(page, 'full thread after open')
    threadId = page.url().split('/c/')[1]?.split(/[?#]/)[0]
    expect(threadId).toBeTruthy()
    await shot(page, '06-full-thread-hud')
  })

  await test.step('Connect rejects ack-only Replied. on conversation POST and DM', async () => {
    const headers = await authHeaders(page)
    const conversationPost = await page.request.post(`/connect/api/conversations/${threadId}/messages/`, {
      headers,
      data: { content: 'Replied.' },
    })
    expect(conversationPost.status(), 'conversation POST Replied. must 400').toBe(400)
    const dm = await page.request.post('/connect/api/messaging/dm/', {
      headers,
      data: { content: 'Replied.' },
    })
    expect([400, 422]).toContain(dm.status())
    const persisted = await page.request.get(`/connect/api/conversations/${threadId}/messages/?limit=30`, { headers })
    expect(persisted.ok()).toBeTruthy()
    const body = await persisted.json()
    const rows = Array.isArray(body) ? body : (body.messages || body.results || [])
    const ours = rows.filter((m) => String(m.content || '').includes(probe.split(':')[0]))
    expect(ours.length, 'probe persisted in Connect').toBeGreaterThan(0)
    const afterProbe = rows.slice(rows.findIndex((m) => String(m.content || '').includes(probe.split(':')[0])) + 1)
    expect(afterProbe.some((m) => /^(replied)\.?$/i.test(String(m.content || '').trim()))).toBeFalsy()
  })

  await test.step('Dashboard link parks the thread as mini-chat and keeps the same HUD', async () => {
    const hud = page.getByTestId('live-voice-overlay')
    await page.getByRole('link', { name: /^Dashboard$/ }).first().click()
    await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 })
    await expect(hud).toBeVisible()
    await expect(hud).toHaveAttribute('data-qa-keep', '1')
    await expect(page.getByTestId('home-live-button')).toBeVisible()
    await expect(page.getByTestId('mini-chat-scroll')).toBeVisible()
    await expect(page.getByTestId('mini-chat-scroll')).toContainText(probe)
    await assertNoGhosts(page, 'homepage after Dashboard')
    await assertSidebarHasNoGhosts(page)
    await shot(page, '07-dashboard-hud-still-up')
  })

  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})
})

test('homepage Live Pulse question gets a real reply, not an ack leftover', async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('/')
  await expect(page.getByTestId('home-live-button')).toBeVisible({ timeout: 20000 })
  await page.getByTestId('home-live-button').click()
  await expect(page.getByTestId('live-voice-overlay')).toBeVisible({ timeout: 20000 })
  const pulseProbe = `live-qa ${Date.now()}: what Pulse tasks are on my queue? one short sentence`
  await sendHomeCompose(page, pulseProbe)
  await expect(page.getByTestId('mini-chat-scroll')).toContainText(pulseProbe, { timeout: 20000 })
  const found = await waitForNewAgentReply(page, pulseProbe, 120000)
  expect(found.text).toContain(pulseProbe)
  expect(found.reply).not.toMatch(/^(replied|done|sent|ok|noted)[.!]?$/i)
  expect(found.reply).not.toMatch(/^keyterms?\s*:/i)
  expect(found.reply).not.toMatch(/^(hive|pulse|cortex|shizuha)[.!?]?$/i)
  expect(found.reply.trim().length).toBeGreaterThan(3)
  await assertNoGhosts(page, 'after Pulse question')
  await waitHudLeavesSpeaking(page, 20000)
  await shot(page, '08-pulse-reply')
  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})
})

test('known operator thread hides leftover Replied. / Keyterms and keeps Live chrome', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto(`/c/${KNOWN_THREAD}`)
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('thread-live-button')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('thread-speak-button')).toBeVisible()
  await expect(page.getByTestId('thread-mic-button')).toBeVisible()
  await expect(page.locator('h3').filter({ hasText: /Ena/i }).first()).toBeVisible({ timeout: 20000 })
  const list = page.getByTestId('connect-message-list')
  await expect(list).toBeVisible({ timeout: 20000 })
  await expect(list).not.toHaveText(/^\s*$/)
  await expect.poll(async () => ((await list.innerText()) || '').trim().length, {
    timeout: 20000,
  }).toBeGreaterThan(20)
  await assertNoGhosts(page, `known thread ${KNOWN_THREAD}`)
  await assertSidebarHasNoGhosts(page)
  await shot(page, '09-known-thread')

  await page.getByTestId('thread-live-button').click()
  const hud = page.getByTestId('live-voice-overlay')
  await expect(hud).toBeVisible({ timeout: 20000 })
  const state = await hudState(page)
  if (state.state === 'error') {
    const err = await page.getByTestId('voice-call-error').textContent().catch(() => state.label)
    throw new Error(`thread Live failed: ${err || 'unknown voice error'}`)
  }
  await expect(page.getByTestId('thread-live-button')).toHaveAttribute('aria-label', 'End Live')
  await hud.evaluate((el) => { el.dataset.qaKeep = '1' })
  await page.getByRole('link', { name: /^Dashboard$/ }).first().click()
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 })
  await expect(hud).toBeVisible()
  await expect(hud).toHaveAttribute('data-qa-keep', '1')
  await expect(homeCompose(page)).toBeVisible()
  await expect(page.getByText(/Good (morning|afternoon|evening)/i).first()).toBeVisible()
  await shot(page, '10-thread-live-to-dashboard')
  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})
})
