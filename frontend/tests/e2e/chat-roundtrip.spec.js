/**
 * CON-240 — Connect chat send/receive round-trip on the home dashboard sidebar.
 *
 * Surface under test: https://shizuha.com/ (ChatHome) conversation list + thread
 * composer ("Message <name>..."), NOT the dedicated /connect/messages route
 * (that surface is tracked separately as CON-265).
 *
 * Live credentials: prefer AGENT_USERNAME / AGENT_PASSWORD (fleet runtime).
 * CI fallback: TEST_USER from fixtures.js.
 *
 * Auth path that works in production: form login at /id/login?continue=/
 * (cookie injection alone is not sufficient — see CON-240 comments).
 */
import { test, expect, TEST_USER } from './fixtures.js'

const CREDS = {
  username: process.env.AGENT_USERNAME || process.env.E2E_USERNAME || TEST_USER.username,
  password: process.env.AGENT_PASSWORD || process.env.E2E_PASSWORD || TEST_USER.password,
}

async function formLoginToHome(page) {
  await page.goto('/id/login?continue=/')
  await page.waitForSelector('input[type="password"]', { timeout: 20000 })

  const inputs = page.locator('form input')
  const n = await inputs.count()
  for (let i = 0; i < n; i++) {
    const type = await inputs.nth(i).getAttribute('type')
    if (type === 'password') {
      await inputs.nth(i).fill(CREDS.password)
    } else if (type !== 'hidden' && type !== 'submit') {
      await inputs.nth(i).fill(CREDS.username)
    }
  }
  await page.locator('button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL((url) => !url.toString().includes('/id/login'), { timeout: 30000 })
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  // Chat sidebar hydrates async from Connect WS/API
  await page.waitForTimeout(8000)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
}

async function openFirstPeerConversation(page) {
  // Prefer a human/agent peer row under CONVERSATIONS; skip pure system noise when possible.
  const opened = await page.evaluate(() => {
    const preferred = ['Aoi', 'Reika', 'Hiro', 'System']
    const nodes = [...document.querySelectorAll('button, a, div, li, span')].filter((el) => {
      if (el.children.length > 12) return false
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 12) return false
      const first = (el.innerText || '').trim().split('\n')[0]
      return preferred.includes(first)
    })
    nodes.sort((a, b) => a.innerText.length - b.innerText.length)
    for (const name of preferred) {
      const hit = nodes.find((el) => (el.innerText || '').trim().split('\n')[0] === name)
      if (hit) {
        hit.click()
        return name
      }
    }
    return null
  })
  if (!opened) {
    throw new Error('No conversation row found in dashboard sidebar')
  }
  await page.waitForTimeout(4000)
  return opened
}

async function waitForThreadComposer(page) {
  const box = page.locator('textarea[placeholder^="Message "]').first()
  await expect(box).toBeVisible({ timeout: 20000 })
  for (let i = 0; i < 20; i++) {
    const ph = (await box.getAttribute('placeholder')) || ''
    const disabled = await box.isDisabled()
    if (!disabled && !/connecting/i.test(ph)) return box
    await page.waitForTimeout(500)
  }
  return box
}

async function clickComposerSend(page) {
  const clicked = await page.evaluate(() => {
    const ta = document.querySelector('textarea[placeholder^="Message "]')
    if (!ta) return false
    let p = ta.parentElement
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const btns = [...p.querySelectorAll('button')].filter((b) => !b.disabled)
      if (btns.length) {
        btns[btns.length - 1].click()
        return true
      }
    }
    return false
  })
  if (!clicked) {
    await page.locator('textarea[placeholder^="Message "]').first().press('Enter')
  }
}

test.describe('CON-240 Connect chat send/receive (dashboard sidebar)', () => {
  test('send message appears in thread and persists via Connect API', async ({ page, context }) => {
    test.setTimeout(120_000)

    await formLoginToHome(page)
    const peer = await openFirstPeerConversation(page)
    const composer = await waitForThreadComposer(page)
    await expect(composer).toHaveAttribute('placeholder', new RegExp(`Message ${peer}`, 'i'))

    const marker = `CON-240-e2e-${Date.now()}`
    await composer.fill(marker)
    await clickComposerSend(page)

    // Optimistic / live render — marker also lands in the sidebar preview row,
    // so assert the thread bubble specifically (whitespace-pre-wrap body).
    await expect(
      page.locator('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap').filter({ hasText: marker }),
    ).toBeVisible({ timeout: 15000 })
    // Composer clears after successful send
    await expect(composer).toHaveValue('')

    // Persist check through Connect REST using the session cookie
    const cookies = await context.cookies()
    const access = cookies.find((c) => c.name === 'shizuha-access-token')
    expect(access?.value, 'shizuha-access-token cookie after form login').toBeTruthy()

    const convRes = await page.request.get('/connect/api/conversations/', {
      headers: { Authorization: `Bearer ${access.value}` },
    })
    expect(convRes.ok()).toBeTruthy()
    const convBody = await convRes.json()
    const conversations = Array.isArray(convBody)
      ? convBody
      : convBody.results || convBody.conversations || []
    expect(conversations.length).toBeGreaterThan(0)

    let persisted = null
    for (const c of conversations.slice(0, 25)) {
      const msgRes = await page.request.get(
        `/connect/api/conversations/${c.id}/messages/?limit=30`,
        { headers: { Authorization: `Bearer ${access.value}` } },
      )
      if (!msgRes.ok()) continue
      const msgBody = await msgRes.json()
      const items = Array.isArray(msgBody)
        ? msgBody
        : msgBody.messages || msgBody.results || []
      const hit = items.find((m) => (m.content || '').includes(marker))
      if (hit) {
        persisted = {
          conversationId: c.id,
          messageId: hit.id,
          content: hit.content,
          created_at: hit.created_at,
        }
        break
      }
    }
    expect(persisted, 'message must persist via Connect messages API').toBeTruthy()
    expect(persisted.content).toContain(marker)
    expect(persisted.created_at).toBeTruthy()

    // Reload retention: reopen peer thread and still see the marker
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    await openFirstPeerConversation(page)
    await page.waitForTimeout(3000)
    await expect(
      page.locator('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap').filter({ hasText: marker }),
    ).toBeVisible({ timeout: 15000 })
  })
})
