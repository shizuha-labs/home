/**
 * CON-240 — Connect chat send/receive round-trip on the home dashboard sidebar.
 *
 * Surface under test: https://shizuha.com/ (ChatHome) conversation list + thread
 * composer ("Message <name>..."), NOT the dedicated /connect/messages route
 * (that surface is tracked separately as CON-265).
 *
 * Live sender credentials: prefer AGENT_USERNAME / AGENT_PASSWORD (fleet
 * runtime). CI fallback: TEST_USER from fixtures.js.
 *
 * Live recipient credentials: E2E_RECIPIENT_USERNAME /
 * E2E_RECIPIENT_PASSWORD. They must identify a different user who shares an
 * organization with the sender. The second login is deliberate: a sender-only
 * reload does not prove recipient delivery.
 *
 * Auth path that works in production: form login at /id/login?continue=/
 * (cookie injection alone is not sufficient — see CON-240 comments).
 */
import { test, expect, TEST_USER } from './fixtures.js'

const SENDER_CREDS = {
  username: process.env.AGENT_USERNAME || process.env.E2E_USERNAME || TEST_USER.username,
  password: process.env.AGENT_PASSWORD || process.env.E2E_PASSWORD || TEST_USER.password,
}

const RECIPIENT_CREDS = {
  username: process.env.E2E_RECIPIENT_USERNAME,
  password: process.env.E2E_RECIPIENT_PASSWORD,
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rows(body, key) {
  if (Array.isArray(body)) return body
  return body?.[key] || body?.results || []
}

async function formLoginToHome(page, creds) {
  await page.goto('/id/login?continue=/')
  await page.waitForSelector('input[type="password"]', { timeout: 20000 })

  const inputs = page.locator('form input')
  const n = await inputs.count()
  for (let i = 0; i < n; i++) {
    const type = await inputs.nth(i).getAttribute('type')
    if (type === 'password') {
      await inputs.nth(i).fill(creds.password)
    } else if (type !== 'hidden' && type !== 'submit') {
      await inputs.nth(i).fill(creds.username)
    }
  }
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/id/api/auth/login/')
      && response.request().method() === 'POST',
    { timeout: 30000 },
  )
  await page.locator('button[type="submit"], input[type="submit"]').first().click()
  const loginResponse = await loginResponsePromise
  expect(loginResponse.ok(), `${creds.username} form login`).toBeTruthy()
  await page.waitForURL((url) => !url.toString().includes('/id/login'), { timeout: 30000 })

  // Do not read the navigated-away login response body here. Chromium may
  // release its Network request identifier as the form submission redirects,
  // making Response.json() fail even though login and navigation succeeded.
  // The post-login cookie and authenticated user endpoint are the durable
  // browser-session boundary the rest of this journey actually consumes.
  const cookies = await page.context().cookies()
  const access = cookies.find((cookie) => cookie.name === 'shizuha-access-token')?.value
  expect(access, `${creds.username} access-token cookie`).toBeTruthy()
  const userResponse = await page.request.get('/id/api/auth/user/', {
    headers: { Authorization: `Bearer ${access}` },
  })
  expect(userResponse.ok(), `${creds.username} authenticated user lookup`).toBeTruthy()
  const user = await userResponse.json()
  expect(user?.id, `${creds.username} user id`).toBeTruthy()

  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  // Chat sidebar hydrates async from Connect WS/API
  await page.waitForTimeout(8000)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  return {
    access,
    user,
  }
}

async function getConversationMessages(page, access, conversationId) {
  const response = await page.request.get(
    `/connect/api/conversations/${conversationId}/messages/?limit=100`,
    { headers: { Authorization: `Bearer ${access}` } },
  )
  expect(response.ok(), `messages API for ${conversationId}`).toBeTruthy()
  return rows(await response.json(), 'messages')
}

async function findOrCreateDirectConversation(page, sender, recipient) {
  const headers = { Authorization: `Bearer ${sender.access}` }
  const listResponse = await page.request.get('/connect/api/conversations/?limit=100', { headers })
  expect(listResponse.ok(), 'sender conversations API').toBeTruthy()

  const expectedIds = [Number(sender.user.id), Number(recipient.user.id)].sort((a, b) => a - b)
  let conversation = rows(await listResponse.json(), 'conversations').find((candidate) => {
    if (candidate.conversation_type !== 'direct') return false
    const participantIds = (candidate.participants || [])
      .filter((participant) => !participant.has_left)
      .map((participant) => Number(participant.user_id))
      .sort((a, b) => a - b)
    return participantIds.length === 2
      && participantIds.every((id, index) => id === expectedIds[index])
  })

  if (!conversation) {
    const createResponse = await page.request.post('/connect/api/conversations/', {
      headers,
      data: {
        conversation_type: 'direct',
        participant_ids: [Number(recipient.user.id)],
      },
    })
    expect(
      createResponse.ok(),
      `create direct conversation for ${sender.user.username} and ${recipient.user.username}`,
    ).toBeTruthy()
    conversation = await createResponse.json()
  }

  const participantIds = (conversation.participants || [])
    .filter((participant) => !participant.has_left)
    .map((participant) => Number(participant.user_id))
    .sort((a, b) => a - b)
  expect(participantIds).toEqual(expectedIds)
  return conversation
}

async function openConversationFromSidebar(page, conversationId, peerName) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Anchor on the row's peer-name <p>, not the button's own text. Playwright
  // matches a RegExp `hasText` against the element's innerText, and a sidebar
  // row renders its avatar initials first ("MI\n\nMio"), so a `^<peerName>`
  // pattern on the button never matches. The name paragraph is exact.
  const peerPattern = new RegExp(`^${escapeRegex(peerName)}$`, 'i')
  const conversationRow = page.locator('button')
    .filter({ has: page.locator('p').filter({ hasText: peerPattern }) })
    .first()
  await expect(conversationRow).toBeVisible({ timeout: 20000 })
  await conversationRow.click()
  await expect(page).toHaveURL(new RegExp(`/c/${conversationId}/?$`), { timeout: 20000 })
  return waitForThreadComposer(page)
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

function messageBody(page, marker) {
  return page.locator('p.whitespace-pre-wrap').filter({
    hasText: new RegExp(`^${escapeRegex(marker)}$`),
  })
}

async function assertRenderedTimestamp(page, marker, apiCreatedAt) {
  const body = messageBody(page, marker)
  await expect(body).toHaveCount(1)
  const timestamp = body.locator(
    'xpath=ancestor::div[contains(@class, "max-w-")][1]'
      + '/div[contains(@class, "mt-0.5")]/span[1]',
  )
  await expect(timestamp).toBeVisible()

  const expectedTime = await page.evaluate(
    (createdAt) => new Date(createdAt).toLocaleTimeString(
      undefined,
      { hour: '2-digit', minute: '2-digit' },
    ),
    apiCreatedAt,
  )
  await expect(timestamp).toHaveText(expectedTime)
}

function assertChronologicalNeighbors(messages, index) {
  expect(index).toBeGreaterThanOrEqual(0)
  const currentTime = Date.parse(messages[index].created_at)
  expect(Number.isFinite(currentTime)).toBeTruthy()

  if (index > 0) {
    expect(Date.parse(messages[index - 1].created_at)).toBeLessThanOrEqual(currentTime)
  }
  if (index + 1 < messages.length) {
    expect(Date.parse(messages[index + 1].created_at)).toBeGreaterThanOrEqual(currentTime)
  }
}

test.describe('CON-240 Connect chat send/receive (dashboard sidebar)', () => {
  test('sender and independent recipient see ordered, timestamped messages', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000)
    expect(
      RECIPIENT_CREDS.username,
      'E2E_RECIPIENT_USERNAME is required for an independent recipient session',
    ).toBeTruthy()
    expect(
      RECIPIENT_CREDS.password,
      'E2E_RECIPIENT_PASSWORD is required for an independent recipient session',
    ).toBeTruthy()
    expect(RECIPIENT_CREDS.username).not.toBe(SENDER_CREDS.username)

    const recipientContext = await browser.newContext({
      baseURL: process.env.BASE_URL || 'http://shizuha-nginx',
    })
    const recipientPage = await recipientContext.newPage()
    try {
      const [sender, recipient] = await Promise.all([
        formLoginToHome(page, SENDER_CREDS),
        formLoginToHome(recipientPage, RECIPIENT_CREDS),
      ])
      expect(Number(sender.user.id)).not.toBe(Number(recipient.user.id))

      const conversation = await findOrCreateDirectConversation(page, sender, recipient)
      const conversationId = conversation.id
      const senderPeer = (conversation.participants || [])
        .find((participant) => Number(participant.user_id) === Number(recipient.user.id))
      const recipientPeer = (conversation.participants || [])
        .find((participant) => Number(participant.user_id) === Number(sender.user.id))
      expect(senderPeer?.user_name).toBeTruthy()
      expect(recipientPeer?.user_name).toBeTruthy()

      const [senderComposer] = await Promise.all([
        openConversationFromSidebar(page, conversationId, senderPeer.user_name),
        openConversationFromSidebar(recipientPage, conversationId, recipientPeer.user_name),
      ])
      await expect(senderComposer).toHaveAttribute(
        'placeholder',
        new RegExp(`Message ${escapeRegex(senderPeer.user_name)}`, 'i'),
      )

      const senderCookies = await context.cookies()
      const recipientCookies = await recipientContext.cookies()
      expect(
        senderCookies.some((cookie) => cookie.name === 'shizuha-access-token'),
        'sender session cookie after form login',
      ).toBeTruthy()
      expect(
        recipientCookies.some((cookie) => cookie.name === 'shizuha-access-token'),
        'recipient session cookie after form login',
      ).toBeTruthy()

      const before = await getConversationMessages(
        recipientPage,
        recipient.access,
        conversationId,
      )
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const firstMarker = `CON-240-e2e-${runId}-1`
      const secondMarker = `CON-240-e2e-${runId}-2`

      for (const marker of [firstMarker, secondMarker]) {
        await senderComposer.fill(marker)
        await clickComposerSend(page)
        await expect(messageBody(page, marker)).toBeVisible({ timeout: 15000 })
        await expect(messageBody(recipientPage, marker)).toBeVisible({ timeout: 15000 })
        await expect(senderComposer).toHaveValue('')
      }

      // Persistence is anchored to the exact two-participant conversation that
      // both browser sessions opened; never scan unrelated conversations.
      const persisted = await getConversationMessages(
        recipientPage,
        recipient.access,
        conversationId,
      )
      const firstIndex = persisted.findIndex((message) => message.content === firstMarker)
      const secondIndex = persisted.findIndex((message) => message.content === secondMarker)
      expect(firstIndex).toBeGreaterThanOrEqual(0)
      expect(secondIndex).toBeGreaterThan(firstIndex)
      if (before.length > 0) {
        const previousTailIndex = persisted.findIndex(
          (message) => message.id === before[before.length - 1].id,
        )
        expect(previousTailIndex, 'pre-send adjacent tail remains before the markers')
          .toBeGreaterThanOrEqual(0)
        expect(previousTailIndex).toBeLessThan(firstIndex)
      }
      assertChronologicalNeighbors(persisted, firstIndex)
      assertChronologicalNeighbors(persisted, secondIndex)

      const firstMessage = persisted[firstIndex]
      const secondMessage = persisted[secondIndex]
      expect(Number(firstMessage.sender_id)).toBe(Number(sender.user.id))
      expect(Number(secondMessage.sender_id)).toBe(Number(sender.user.id))
      await assertRenderedTimestamp(recipientPage, firstMarker, firstMessage.created_at)
      await assertRenderedTimestamp(recipientPage, secondMarker, secondMessage.created_at)

      const renderedInOrder = await recipientPage.evaluate(
        ({ first, second }) => {
          const bodies = [...document.querySelectorAll('p.whitespace-pre-wrap')]
          const firstIndexInDom = bodies.findIndex((node) => node.textContent === first)
          const secondIndexInDom = bodies.findIndex((node) => node.textContent === second)
          return firstIndexInDom >= 0 && secondIndexInDom > firstIndexInDom
        },
        { first: firstMarker, second: secondMarker },
      )
      expect(renderedInOrder, 'recipient DOM preserves send order').toBeTruthy()

      // Both recipient-delivery markers survive a new browser document.
      await recipientPage.reload({ waitUntil: 'domcontentloaded' })
      await expect(messageBody(recipientPage, firstMarker)).toBeVisible({ timeout: 20000 })
      await expect(messageBody(recipientPage, secondMarker)).toBeVisible({ timeout: 20000 })
    } finally {
      await recipientContext.close()
    }
  })
})
