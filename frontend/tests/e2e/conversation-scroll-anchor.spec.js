import { test, expect } from './fixtures.js'

const CONVERSATIONS = [
  {
    id: 'con-235-a',
    conversation_type: 'direct',
    name: '',
    unread_count: 5,
    last_message_preview: 'Latest seeded message',
    participants: [{ user_id: 999, user_name: 'Anchor Agent', has_left: false }],
    participant_names: ['Anchor Agent'],
  },
  {
    id: 'con-235-b',
    conversation_type: 'direct',
    name: '',
    unread_count: 0,
    last_message_preview: 'Second conversation',
    participants: [{ user_id: 998, user_name: 'Switch Agent', has_left: false }],
    participant_names: ['Switch Agent'],
  },
]

function message(id, conversationId, content) {
  return {
    id,
    conversation_id: conversationId,
    sender_id: 999,
    sender_name: 'Anchor Agent',
    sender_username: 'anchor-agent',
    sender_email: 'anchor-agent@agents.shizuha.io',
    sender_is_agent: true,
    agent_id: 'anchor-agent',
    message_type: 'text',
    content,
    media_url: '',
    media_metadata: {},
    reactions: {},
    is_edited: false,
    is_deleted: false,
    read_by: [],
    delivered_to: [],
    created_at: new Date(Date.UTC(2026, 6, 18, 0, Number(id.match(/\d+/)?.[0] || 0))).toISOString(),
    updated_at: new Date().toISOString(),
  }
}

const initialA = Array.from({ length: 50 }, (_, index) =>
  message(
    `message-${index}`,
    'con-235-a',
    index === 49
      ? 'Latest seeded message\n\n![Variable-height content](/con235-variable-height.svg)'
      : `Message ${index}: ${'history '.repeat(18)}`,
  ),
)
const olderA = Array.from({ length: 20 }, (_, index) =>
  message(`older-${index}`, 'con-235-a', `Older ${index}: ${'pagination '.repeat(18)}`),
)
const initialB = Array.from({ length: 40 }, (_, index) =>
  message(`switch-${index}`, 'con-235-b', `Switch ${index}: ${'conversation '.repeat(18)}`),
)

async function installMockConnect(page) {
  let socket
  let releaseImage
  let releaseOlder
  const imageGate = new Promise((resolve) => { releaseImage = resolve })
  const olderGate = new Promise((resolve) => { releaseOlder = resolve })

  await page.routeWebSocket('**/connect/ws/connect/user/**', (ws) => {
    socket = ws
    ws.onMessage((payload) => {
      const parsed = JSON.parse(String(payload))
      if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })
  })

  await page.route('**/connect/api/conversations/', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/connect/api/conversations/') return route.fallback()
    await route.fulfill({ json: CONVERSATIONS })
  })
  await page.route('**/connect/api/conversations/*/read/', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/connect/api/connections/requests/', (route) => route.fulfill({ json: [] }))
  await page.route('**/connect/api/conversations/*/messages/**', async (route) => {
    const url = new URL(route.request().url())
    const conversationId = url.pathname.split('/')[4]
    const before = url.searchParams.get('before')
    if (conversationId === 'con-235-a') {
      if (before) await olderGate
      await route.fulfill({ json: before ? olderA : initialA })
    } else {
      await route.fulfill({ json: initialB })
    }
  })
  await page.route('**/con235-variable-height.svg', async (route) => {
    await imageGate
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="700"><rect width="120" height="700" fill="#8b5cf6"/></svg>',
    })
  })

  return {
    sendIncoming(payload) {
      if (!socket) throw new Error('mock Connect WebSocket did not open')
      socket.send(JSON.stringify(payload))
    },
    releaseImage,
    releaseOlder,
  }
}

test('CON-235 opens at latest without a painted top frame and preserves reader intent', async ({ page }) => {
  await page.addInitScript(() => {
    // Keep this regression deterministic and independent of the live ID service:
    // AuthProvider only needs a non-expired token plus the cached user shape.
    const payload = btoa(JSON.stringify({ enabled_services: ['connect'], exp: 4_102_444_800 }))
    localStorage.setItem('shizuha_access_token', `header.${payload}.signature`)
    localStorage.setItem('shizuha_user', JSON.stringify({ id: 1, username: 'con235-browser' }))
    window.__con235Frames = []
    const sampleFrame = () => {
      const list = document.querySelector('[data-testid="connect-message-list"]')
      if (list && list.scrollHeight > list.clientHeight) {
        window.__con235Frames.push({
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
        })
      }
      requestAnimationFrame(sampleFrame)
    }
    requestAnimationFrame(sampleFrame)
  })

  const connect = await installMockConnect(page)
  await page.goto('/c/con-235-a')

  const list = page.getByTestId('connect-message-list')
  await expect(list).toBeVisible()
  await expect.poll(async () => list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100)

  const firstOverflowFrame = await page.evaluate(() => window.__con235Frames[0])
  expect(firstOverflowFrame.scrollHeight - firstOverflowFrame.scrollTop - firstOverflowFrame.clientHeight)
    .toBeLessThanOrEqual(80)

  await expect(page.getByRole('button', { name: 'Jump to first unread message' })).toContainText('5 unread')
  await expect(page.getByLabel('Unread messages')).toHaveCount(1)

  // A delayed image expands the latest message after initial history hydration.
  // A pinned reader must remain pinned rather than being left above the image.
  connect.releaseImage()
  await expect(page.getByAltText('Variable-height content')).toBeVisible()
  await expect.poll(async () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)

  // Reading older history + incoming WS traffic: preserve the viewport and show
  // an explicit new-message affordance instead of yanking to the bottom.
  await list.evaluate((el) => {
    el.scrollTop = Math.max(200, el.scrollHeight / 2)
    el.dispatchEvent(new Event('scroll'))
  })
  const beforeIncoming = await list.evaluate((el) => el.scrollTop)
  connect.sendIncoming({
    type: 'new_message',
    conversation_id: 'con-235-a',
    message: message('incoming-1', 'con-235-a', 'Incoming while reading history'),
  })
  await expect(page.getByRole('button', { name: 'Jump to latest message' })).toContainText('1 new')
  expect(await list.evaluate((el) => el.scrollTop)).toBeCloseTo(beforeIncoming, -1)

  // Loading older pages prepends content, but the same visible message remains
  // at the same viewport position (no pagination layout jump).
  const anchor = page.getByText('Message 0:', { exact: false }).first()
  await list.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  const beforePrepend = await anchor.evaluate((el) => el.getBoundingClientRect().top)
  connect.releaseOlder()
  await expect(page.getByText('Older 0:', { exact: false })).toBeVisible()
  const afterPrepend = await anchor.evaluate((el) => el.getBoundingClientRect().top)
  expect(Math.abs(afterPrepend - beforePrepend)).toBeLessThanOrEqual(2)

  // A conversation switch remounts the list and starts the new thread at its
  // own latest message rather than inheriting the previous scroll position.
  await page.getByRole('button', { name: /Switch Agent/ }).click()
  await expect(page).toHaveURL(/\/c\/con-235-b$/)
  await expect.poll(async () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)
})
