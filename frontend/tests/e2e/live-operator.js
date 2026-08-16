/**
 * Shared helpers for live QA against shizuha.com.
 *
 * Default caller is the non-privileged Live QA human (`liveqa`) talking to
 * Yuna — never the operator mailbox or Ena. Opt in to the operator path
 * only with SHIZUHA_LIVE_OPERATOR_E2E=1.
 *
 * Credentials: ~/.shizuha/live-qa-creds (two lines: username, password).
 * Never log the password. Never fall back to operator-ui-creds.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from '@playwright/test'

export const KNOWN_THREAD = 'bb516974-4152-427a-a2ac-04535b5f393f'
export const LIVE_QA_AGENT = 'enaqa'
export const GHOST_RE = /^(Replied\.?|Keyterms?\s*:)/im

function isOperatorUsername(user) {
  const u = String(user || '').toLowerCase()
  return u === 'hritik' || u === 'hothritik1' || u.includes('hothritik')
}

function readCredFile(credPath) {
  try {
    const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (lines[0] && lines[1]) return { user: lines[0], pass: lines[1] }
  } catch {
    /* missing file is a skip, not a leak */
  }
  return { user: '', pass: '' }
}

export function loadLiveQaCreds() {
  const user = process.env.LIVE_QA_USER
  const pass = process.env.LIVE_QA_PASS
  if (user && pass && !isOperatorUsername(user)) return { user, pass }
  const credPath = process.env.SHIZUHA_LIVE_QA_CREDS
    || path.join(os.homedir(), '.shizuha', 'live-qa-creds')
  const fromFile = readCredFile(credPath)
  if (fromFile.user && fromFile.pass && !isOperatorUsername(fromFile.user)) return fromFile
  return { user: '', pass: '' }
}

export function loadOperatorCreds() {
  const user = process.env.HRITIK_USER
  const pass = process.env.HRITIK_PASS
  if (user && pass) return { user, pass }
  const credPath = process.env.SHIZUHA_OPERATOR_CREDS
    || path.join(os.homedir(), '.shizuha', 'operator-ui-creds')
  return readCredFile(credPath)
}

export function loadLiveCallerCreds() {
  if (process.env.SHIZUHA_LIVE_OPERATOR_E2E === '1') return loadOperatorCreds()
  return loadLiveQaCreds()
}

export function liveAgentUsername() {
  if (process.env.SHIZUHA_LIVE_OPERATOR_E2E === '1') {
    return process.env.SHIZUHA_LIVE_AGENT || 'ena'
  }
  return process.env.SHIZUHA_LIVE_QA_AGENT || LIVE_QA_AGENT
}

export async function selectHomeAgent(page, username = liveAgentUsername()) {
  await page.evaluate((name) => {
    try { localStorage.setItem('shizuha_home_agent', name) } catch { /* private mode */ }
  }, username)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('home-live-button')).toBeVisible({ timeout: 20000 })
  const picker = page.getByTestId('home-agent-picker')
  if (await picker.count()) {
    const label = username === 'enaqa' ? /enaqa|Ena QA/i : new RegExp(username, 'i')
    await expect(picker).toContainText(label, { timeout: 20000 })
  }
  // Open the existing DM so Live sends on the thread even if fleet search
  // is staff-only on the current deploy.
  const thread = page.getByRole('button', { name: username === 'enaqa' ? /Ena QA/i : new RegExp(username, 'i') }).first()
  await expect(thread).toBeVisible({ timeout: 20000 })
  await thread.click()
  await page.waitForURL(/\/c\//, { timeout: 15000 })
}

export async function loginHome(page) {
  const { user, pass } = loadLiveCallerCreds()
  if (process.env.SHIZUHA_LIVE_OPERATOR_E2E !== '1') {
    expect(user, 'live QA username must not be the operator').not.toMatch(/hritik/i)
  }
  await page.goto('/id/login?continue=/')
  await page.waitForLoadState('domcontentloaded')
  if (!page.url().includes('/id/login')) {
    await page.goto('/')
  } else {
    await page.waitForSelector('#username, input[type="password"]', { timeout: 20000 })
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.locator('#username').count()) {
        await page.fill('#username', user)
        await expect(page.locator('#username')).toHaveValue(user)
        await page.fill('#password', pass)
      } else {
        const inputs = page.locator('form input')
        const n = await inputs.count()
        for (let i = 0; i < n; i += 1) {
          const type = await inputs.nth(i).getAttribute('type')
          if (type === 'password') await inputs.nth(i).fill(pass)
          else if (type !== 'hidden' && type !== 'submit') await inputs.nth(i).fill(user)
        }
      }
      const loginResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/id/api/auth/login/')
          && response.request().method() === 'POST',
        { timeout: 30000 },
      )
      await page.locator('button[type="submit"], input[type="submit"]').first().click()
      const loginResponse = await loginResponsePromise
      lastStatus = loginResponse.status()
      if (loginResponse.ok()) break
      if (attempt < 2) await page.waitForTimeout(1500 * (attempt + 1))
    }
    expect(lastStatus, 'operator form login').toBeLessThan(400)
    await page.waitForURL((url) => !url.toString().includes('/id/login'), { timeout: 30000 })
  }

  const access = await bearerToken(page)
  expect(access, 'access token after login').toBeTruthy()
  const userResponse = await page.request.get('/id/api/auth/user/', {
    headers: { Authorization: `Bearer ${access}` },
  })
  expect(userResponse.ok(), 'authenticated user lookup').toBeTruthy()
  const me = await userResponse.json()
  expect(me?.id, 'user id').toBeTruthy()

  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await selectHomeAgent(page, liveAgentUsername())
  const liveBtn = page.getByTestId('home-live-button').or(page.getByTestId('thread-live-button'))
  await expect(liveBtn.first()).toBeVisible({ timeout: 20000 })
  return { access, user: me }
}

export async function bearerToken(page) {
  const cookies = await page.context().cookies()
  const cookie = cookies.find((c) => c.name === 'shizuha-access-token')?.value
  if (cookie) return cookie
  return page.evaluate(() => window.localStorage.getItem('shizuha_access_token') || '')
}

export async function authHeaders(page) {
  const access = await bearerToken(page)
  return { Authorization: `Bearer ${access}` }
}

export async function shot(page, name) {
  const dir = path.join(process.cwd(), 'test-results', 'live-operator')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

export async function visibleTalkText(page) {
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[data-testid="mini-chat-scroll"]'),
      ...document.querySelectorAll('[data-testid="connect-message-list"]'),
      ...document.querySelectorAll('[data-testid="message-list"]'),
    ]
    return nodes.map((n) => n.innerText || '').join('\n')
  })
}

export async function assertNoGhosts(page, where) {
  const text = await visibleTalkText(page)
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const ghosts = lines.filter((line) => GHOST_RE.test(line) || /^keyterms?\s*:/i.test(line))
  expect(ghosts, `${where}: no Replied. / Keyterms leftovers`).toEqual([])
}

export function homeCompose(page) {
  return page.locator('[data-testid="home-compose"], textarea[placeholder^="Ask "]').first()
}

export function homeMainScroll(page) {
  return page.locator('[data-testid="home-main-scroll"]').or(
    page.locator('textarea[placeholder^="Ask "]').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]'),
  )
}

export async function hudState(page) {
  const hud = page.getByTestId('live-voice-overlay')
  if (!(await hud.count())) return { present: false, state: '', label: '' }
  const attr = (await hud.getAttribute('data-call-state')) || ''
  let label = ''
  const labeled = page.getByTestId('live-voice-state')
  if (await labeled.count()) {
    label = ((await labeled.textContent()) || '').trim()
  } else {
    const txt = (await hud.innerText()) || ''
    const match = txt.match(/\b(Muted|Connecting|Listening|Thinking|Speaking|Unavailable)\b/i)
    label = match ? match[1] : ''
  }
  return {
    present: true,
    state: (attr || label || '').toLowerCase(),
    label,
  }
}

export async function assertSidebarHasNoGhosts(page) {
  const previews = page.getByTestId('conversation-preview')
  const n = await previews.count()
  const ghosts = []
  for (let i = 0; i < n; i += 1) {
    const text = ((await previews.nth(i).innerText()) || '').trim()
    if (/^(replied\.?|keyterms?\s*:)/i.test(text)) ghosts.push(text)
  }
  expect(ghosts, 'sidebar conversation previews must not show Replied. / Keyterms').toEqual([])
}

export async function waitHudLeavesSpeaking(page, timeoutMs = 20000) {
  const started = Date.now()
  let sawSpeaking = false
  let leftSpeakingAt = 0
  while (Date.now() - started < timeoutMs) {
    const now = await hudState(page)
    const speaking = now.state === 'speaking' || /^speaking/i.test(now.label)
    if (speaking) sawSpeaking = true
    else if (sawSpeaking && !leftSpeakingAt) leftSpeakingAt = Date.now()
    else if (!speaking && leftSpeakingAt && Date.now() - leftSpeakingAt >= 400) {
      return { sawSpeaking, stuck: false, ms: Date.now() - started, ...now }
    }
    await page.waitForTimeout(250)
  }
  const last = await hudState(page)
  const stuck = last.state === 'speaking' || /^speaking/i.test(last.label)
  expect(stuck, 'HUD must leave Speaking so TTS/listen can resume').toBeFalsy()
  return { sawSpeaking, stuck, ms: Date.now() - started, ...last }
}

export async function sendHomeCompose(page, text) {
  const box = homeCompose(page)
  await expect(box).toBeVisible({ timeout: 15000 })
  await box.click({ timeout: 5000 }).catch(() => {})
  await box.fill(text)
  // Enter is the operator path. Clicking the send icon is intercepted by the
  // Live HUD / mini-chat once Playwright scrolls the icon into view.
  await box.press('Enter')
}
