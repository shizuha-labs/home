/**
 * CON-241 — Connect chat delivery semantics on the home dashboard sidebar:
 * optimistic send, delayed (async) inbound render, send-failure behavior,
 * duplicate prevention, and message ordering.
 *
 * Surface under test: https://shizuha.com/ (ChatHome) thread view backed by
 * @shizuha/chat (packages/shizuha-chat). Client contract exercised here
 * (from useMessages.ts / useConnectWebSocket.ts / ChatHome.jsx):
 *  - sendMessage appends an optimistic bubble (client_message_id UUID)
 *    BEFORE any network round-trip, then delivers over the user WebSocket
 *    (`{type:'send_message', conversation_id, content, client_message_id}`).
 *  - The server echo (`new_message`) reconciles the optimistic bubble by
 *    client_message_id; addMessage also dedupes by server id.
 *  - CON-283: an unacknowledged WS send is marked _failed after a ~10s ack
 *    timeout, and a Retry affordance re-sends it reusing the same
 *    client_message_id (server idempotency dedupes any duplicate).
 *  - ChatHome disables the composer while the WS is down (`disabled={!isConnected}`),
 *    so the REST fallback in useMessages is not reachable from this surface.
 *  - A send_message frame that never reaches the server surfaces Failed + Retry
 *    after the ack timeout; retrying reconciles the bubble via new_message echo.
 *
 * Live credentials: prefer AGENT_USERNAME / AGENT_PASSWORD (fleet runtime).
 * CI fallback: TEST_USER from fixtures.js.
 */
import { test, expect, TEST_USER } from './fixtures.js'

const CREDS = {
  username: process.env.AGENT_USERNAME || process.env.E2E_USERNAME || TEST_USER.username,
  password: process.env.AGENT_PASSWORD || process.env.E2E_PASSWORD || TEST_USER.password,
}

// Isolated peer fixture: a SINGLE explicit conversation, defaulting to the
// QA pod's own Zen seat so regression runs post markers only into a QA-owned
// thread, never arbitrary operational agent seats. (The System conversation
// cannot serve here: its account shares no org with the runner, so the REST
// leg is rejected 403 cross_org_not_allowed by the tenancy gate.) Override
// with E2E_PEER_NAME for a dedicated fixture; the suite FAILS CLOSED if the
// named row is absent (no fallback scan).
const QA_PEER = process.env.E2E_PEER_NAME || 'Zen'
const WS_GLOB = '**/ws/connect/user/**'

// Serial: all tests share one account; parallel sessions would cross-deliver
// each other's markers into the same threads.
test.describe.configure({ mode: 'serial' })

async function formLoginToHome(page) {
  // Bounded retry: the edge occasionally 504s a single navigation.
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('/id/login?continue=/')
      await page.waitForSelector('input[type="password"]', { timeout: 20000 })
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      await page.waitForTimeout(3000)
    }
  }
  if (lastErr) throw lastErr
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

async function accessToken(context) {
  const cookies = await context.cookies()
  const c = cookies.find((x) => x.name === 'shizuha-access-token')
  expect(c?.value, 'shizuha-access-token cookie after form login').toBeTruthy()
  return c.value
}

async function openPeerConversation(page) {
  const opened = await page.evaluate((peer) => {
    const nodes = [...document.querySelectorAll('button, a, div, li, span')].filter((el) => {
      if (el.children.length > 12) return false
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 12) return false
      return (el.innerText || '').trim().split('\n')[0] === peer
    })
    nodes.sort((a, b) => a.innerText.length - b.innerText.length)
    if (nodes.length) {
      nodes[0].click()
      return peer
    }
    return null
  }, QA_PEER)
  // Fail closed: the isolated peer fixture must exist — never fall back to an
  // arbitrary live agent conversation.
  expect(opened, `isolated QA peer conversation "${QA_PEER}" in the dashboard sidebar`).toBeTruthy()
  await page.waitForTimeout(4000)
  return opened
}

async function waitForComposer(page) {
  const box = page.locator('textarea[placeholder^="Message "]').first()
  await expect(box).toBeVisible({ timeout: 20000 })
  for (let i = 0; i < 20; i++) {
    if (!(await box.isDisabled())) return box
    await page.waitForTimeout(500)
  }
  expect(await box.isDisabled(), 'composer enabled (WS connected)').toBe(false)
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

/** Thread bubbles containing the marker (excludes the sidebar preview row). */
function bubbles(page, marker) {
  return page
    .locator('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap')
    .filter({ hasText: marker })
}

/** Count occurrences of marker in the persisted conversation via Connect REST. */
async function countPersisted(page, token, marker) {
  const convRes = await page.request.get('/connect/api/conversations/', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(convRes.ok()).toBeTruthy()
  const body = await convRes.json()
  const conversations = Array.isArray(body) ? body : body.results || body.conversations || []
  let hits = 0
  let convId = null
  for (const c of conversations.slice(0, 25)) {
    const msgRes = await page.request.get(
      `/connect/api/conversations/${c.id}/messages/?limit=30`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!msgRes.ok()) continue
    const mb = await msgRes.json()
    const msgs = Array.isArray(mb) ? mb : mb.messages || mb.results || []
    const found = msgs.filter((m) => (m.content || '').includes(marker))
    if (found.length) {
      hits += found.length
      convId = c.id
    }
  }
  return { hits, convId }
}

test.describe('CON-241 Connect chat delivery semantics (dashboard sidebar)', () => {
  test('optimistic send: bubble renders before server delivery, echo reconciles without duplicate', async ({ page, context }) => {
    test.setTimeout(150_000)

    const DELAY_MS = 2500
    // Pass WS through but delay outbound send_message frames so the server
    // echo cannot be what renders the bubble.
    await page.routeWebSocket(WS_GLOB, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((msg) => {
        let isSend = false
        try {
          isSend = JSON.parse(String(msg)).type === 'send_message'
        } catch { /* non-JSON frame */ }
        if (isSend) {
          setTimeout(() => server.send(msg), DELAY_MS)
        } else {
          server.send(msg)
        }
      })
      server.onMessage((msg) => ws.send(msg))
    })

    await formLoginToHome(page)
    await openPeerConversation(page)
    const composer = await waitForComposer(page)

    const marker = `CON-241-opt-${Date.now()}`
    await composer.fill(marker)
    const t0 = Date.now()
    await clickComposerSend(page)

    // Optimistic: visible well before the delayed frame reaches the server.
    await expect(bubbles(page, marker).first()).toBeVisible({ timeout: 1200 })
    expect(Date.now() - t0).toBeLessThan(DELAY_MS)
    // Composer clears on send, not on ack.
    await expect(composer).toHaveValue('')

    // After the echo lands, reconciliation must leave exactly one bubble.
    await page.waitForTimeout(DELAY_MS + 4000)
    await expect(bubbles(page, marker)).toHaveCount(1)

    // Exactly one persisted copy.
    const token = await accessToken(context)
    const { hits } = await countPersisted(page, token, marker)
    expect(hits, 'persisted copies of the optimistic marker').toBe(1)
  })

  test('delayed inbound: async new_message renders live in-order; HTTP self-echo stays suppressed (CON-106/PLAT-965)', async ({ page, context }) => {
    test.setTimeout(150_000)

    // Passthrough route that also lets the test inject server->client frames,
    // exactly shaped like UserChatConsumer.new_message delivery.
    let injectFrame = null
    await page.routeWebSocket(WS_GLOB, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((msg) => server.send(msg))
      server.onMessage((msg) => ws.send(msg))
      injectFrame = (obj) => ws.send(JSON.stringify(obj))
    })

    await formLoginToHome(page)
    await openPeerConversation(page)
    await waitForComposer(page)

    // Anchor the thread with a composer send so we can locate the active
    // conversation id via REST.
    const anchor = `CON-241-anchor-${Date.now()}`
    const composer = page.locator('textarea[placeholder^="Message "]').first()
    await composer.fill(anchor)
    await clickComposerSend(page)
    await expect(bubbles(page, anchor).first()).toBeVisible({ timeout: 15000 })

    const token = await accessToken(context)
    let convId = null
    await expect(async () => {
      const res = await countPersisted(page, token, anchor)
      expect(res.convId).toBeTruthy()
      convId = res.convId
    }).toPass({ timeout: 20000 })

    // Persist a message OUTSIDE the composer (REST). Server contract
    // (CON-106 / PLAT-965): HTTP-posted messages carry no origin_channel, so
    // the sender's OWN socket must NOT receive the echo.
    const marker = `CON-241-inbound-${Date.now()}`
    const postRes = await page.request.post(`/connect/api/conversations/${convId}/messages/`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { content: marker, message_type: 'text', client_message_id: crypto.randomUUID() },
    })
    expect(postRes.ok(), `REST send status ${postRes.status()}`).toBeTruthy()
    const persisted = await postRes.json()
    await page.waitForTimeout(5000)
    await expect(
      bubbles(page, marker),
      'HTTP self-echo must be suppressed on the sender socket',
    ).toHaveCount(0)

    // Now deliver the SAME persisted message the way the server delivers it to
    // other participants' sockets — the open thread must render it live, with
    // no reload, appended after the anchor.
    expect(injectFrame, 'WS route captured for frame injection').toBeTruthy()
    injectFrame({
      type: 'new_message',
      conversation_id: convId,
      message: persisted,
      delivery_state: 'delivered',
    })

    await expect(bubbles(page, marker).first()).toBeVisible({ timeout: 10000 })
    await expect(bubbles(page, marker)).toHaveCount(1)

    // Async arrival must append after the anchor (ordering of delayed delivery).
    const order = await page.evaluate(([a, m]) => {
      const ps = [...document.querySelectorAll('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap')]
      return {
        anchorIdx: ps.findIndex((p) => p.textContent.includes(a)),
        markerIdx: ps.findIndex((p) => p.textContent.includes(m)),
      }
    }, [anchor, marker])
    expect(order.anchorIdx).toBeGreaterThanOrEqual(0)
    expect(order.markerIdx).toBeGreaterThan(order.anchorIdx)

    // The persisted message must survive a reload exactly once (history render).
    await page.goto('/')
    await page.waitForTimeout(8000)
    await openPeerConversation(page)
    await page.waitForTimeout(3000)
    await expect(bubbles(page, marker)).toHaveCount(1)
  })

  test('dropped send frame: ack timeout surfaces Failed + Retry, and retry succeeds via idempotent client_message_id (CON-283)', async ({ page, context }) => {
    test.setTimeout(180_000)

    // Connect the WS normally but DROP only the FIRST outbound send_message
    // frame — models a frame lost to a dying connection. The retry (same
    // client_message_id) is allowed through so the message reconciles.
    let droppedFirst = false
    await page.routeWebSocket(WS_GLOB, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((msg) => {
        let isSend = false
        try {
          isSend = JSON.parse(String(msg)).type === 'send_message'
        } catch { /* non-JSON frame */ }
        if (isSend && !droppedFirst) {
          droppedFirst = true
          return // drop the first send_message frame
        }
        server.send(msg)
      })
      server.onMessage((msg) => ws.send(msg))
    })

    await formLoginToHome(page)
    await openPeerConversation(page)
    const composer = await waitForComposer(page)

    const marker = `CON-283-drop-${Date.now()}`
    await composer.fill(marker)
    await clickComposerSend(page)

    // Optimistic bubble appears and composer clears even though delivery is lost.
    await expect(bubbles(page, marker).first()).toBeVisible({ timeout: 5000 })
    await expect(composer).toHaveValue('')

    // CON-283: after the ack timeout (~10s) the unconfirmed WS send is marked
    // failed — a Failed label AND a Retry affordance appear beside the bubble.
    // Scope to the SHARED thread container (deepest div holding both the
    // message list bubble and the composer) so other dashboard widgets' own
    // Retry buttons don't pollute the assertion.
    const threadPanel = page
      .locator('div')
      .filter({ has: page.locator('textarea[placeholder^="Message "]') })
      .filter({ has: bubbles(page, marker).first() })
      .last()
    await expect(threadPanel.getByText('Failed', { exact: true })).toBeVisible({ timeout: 20000 })
    const retryBtn = threadPanel.getByRole('button', { name: /retry|resend/i })
    await expect(retryBtn.first()).toBeVisible({ timeout: 5000 })

    // Nothing was persisted server-side yet (the frame was dropped).
    const token = await accessToken(context)
    const { hits } = await countPersisted(page, token, marker)
    expect(hits, 'persisted copies of the dropped marker before retry').toBe(0)

    // Click Retry — the same client_message_id is reused, the server's
    // unique_client_message_per_conversation idempotency dedupes any duplicate,
    // and the new_message echo reconciles the bubble (Failed disappears).
    await retryBtn.first().click()
    await expect(threadPanel.getByText('Failed', { exact: true })).toHaveCount(0, { timeout: 20000 })
    await expect(bubbles(page, marker)).toHaveCount(1)

    // The retried message persisted server-side exactly once.
    const { hits: afterHits } = await countPersisted(page, token, marker)
    expect(afterHits, 'persisted copies of the retried marker').toBe(1)

    // The reconciled bubble survives a reload (it is no longer optimistic-only).
    await page.goto('/')
    await page.waitForTimeout(8000)
    await openPeerConversation(page)
    await page.waitForTimeout(3000)
    await expect(bubbles(page, marker)).toHaveCount(1)
  })

  test('ordering: rapid consecutive sends render, persist and reload in send order', async ({ page, context }) => {
    test.setTimeout(150_000)

    await formLoginToHome(page)
    await openPeerConversation(page)
    const composer = await waitForComposer(page)

    const base = `CON-241-ord-${Date.now()}`
    const markers = [`${base}-A`, `${base}-B`, `${base}-C`]
    for (const m of markers) {
      await composer.fill(m)
      await clickComposerSend(page)
      // no settle wait — rapid-fire is the point
    }
    for (const m of markers) {
      await expect(bubbles(page, m).first()).toBeVisible({ timeout: 15000 })
    }
    // Let echoes reconcile before asserting counts/order.
    await page.waitForTimeout(5000)
    for (const m of markers) {
      await expect(bubbles(page, m)).toHaveCount(1)
    }

    const domOrder = await page.evaluate((ms) => {
      const ps = [...document.querySelectorAll('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap')]
      return ms.map((m) => ps.findIndex((p) => p.textContent.includes(m)))
    }, markers)
    expect(domOrder[0]).toBeGreaterThanOrEqual(0)
    expect(domOrder[1]).toBeGreaterThan(domOrder[0])
    expect(domOrder[2]).toBeGreaterThan(domOrder[1])

    // Server persisted exactly one copy of each, in send order.
    const token = await accessToken(context)
    const { convId } = await countPersisted(page, token, markers[0])
    expect(convId).toBeTruthy()
    const msgRes = await page.request.get(
      `/connect/api/conversations/${convId}/messages/?limit=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const mb = await msgRes.json()
    const msgs = Array.isArray(mb) ? mb : mb.messages || mb.results || []
    const apiIdx = markers.map((m) => msgs.findIndex((x) => (x.content || '').includes(m)))
    for (const m of markers) {
      expect(msgs.filter((x) => (x.content || '').includes(m)).length, `persisted count for ${m}`).toBe(1)
    }
    expect(apiIdx[0]).toBeGreaterThanOrEqual(0)
    expect(apiIdx[1]).toBeGreaterThan(apiIdx[0])
    expect(apiIdx[2]).toBeGreaterThan(apiIdx[1])

    // Order survives a reload (persisted render path, not just live append).
    await page.goto('/')
    await page.waitForTimeout(8000)
    await openPeerConversation(page)
    await page.waitForTimeout(3000)
    const reloadOrder = await page.evaluate((ms) => {
      const ps = [...document.querySelectorAll('p.whitespace-pre-wrap, p.m-0.whitespace-pre-wrap')]
      return ms.map((m) => ps.findIndex((p) => p.textContent.includes(m)))
    }, markers)
    expect(reloadOrder[0]).toBeGreaterThanOrEqual(0)
    expect(reloadOrder[1]).toBeGreaterThan(reloadOrder[0])
    expect(reloadOrder[2]).toBeGreaterThan(reloadOrder[1])
  })
})
