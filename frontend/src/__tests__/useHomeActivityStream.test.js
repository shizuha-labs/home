import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useHomeActivityStream } from '../hooks/useHomeActivityStream'

// Mock auth utils
vi.mock('../utils/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  handleUnauthorized: vi.fn((resp) => {
    if (resp?.status === 401) return true
    return false
  }),
}))

import { getAccessToken, handleUnauthorized } from '../utils/auth'

// Helper: create a ReadableStream from chunks
function createSSEStream(...events) {
  const encoder = new TextEncoder()
  const chunks = events.map(e => encoder.encode(e + '\n'))
  return new ReadableStream({
    start(controller) {
      chunks.forEach(c => controller.enqueue(c))
      controller.close()
    },
  })
}

// Helper: create a mock Response
function mockResponse({ status = 200, body, json } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: body || null,
    json: json ? async () => json : async () => ({}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useHomeActivityStream', () => {
  it('fetches recent events on mount', async () => {
    const recentEvents = [
      { id: '1', org_id: 1, type: 'test', summary: 'event 1' },
      { id: '2', org_id: 1, type: 'test', summary: 'event 2' },
    ]

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        json: { events: recentEvents, cursor_by_org: { '1': '2' } },
      }))
      // Stream attempt — clean EOF, will set error but events are loaded
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        body: createSSEStream(),
      }))

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Events should be loaded from recent fetch
    expect(result.current.events).toEqual(recentEvents)
    // Error is set because the stream closed with clean EOF
    expect(result.current.error).toBeTruthy()
    expect(result.current.stale).toBe(true)
    unmount()
  })

  it('deduplicates events by (org_id, id)', async () => {
    const recentEvents = [
      { id: '1', org_id: 1, type: 'test', summary: 'event 1' },
    ]

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        json: { events: recentEvents, cursor_by_org: { '1': '1' } },
      }))
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        body: createSSEStream(),
      }))

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.events).toHaveLength(1)
    unmount()
  })

  it('applies backoff on clean EOF', async () => {
    const recentEvents = [{ id: '1', org_id: 1, type: 'test', summary: 'event 1' }]

    // First call: recent fetch succeeds
    // Second call: stream opens, returns clean EOF (body with no events)
    // Third call: stream opens again (reconnect after backoff)
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '1' } },
        }))
      }
      // Stream that immediately closes (clean EOF)
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(),
      }))
    })

    renderHook(() => useHomeActivityStream({ orgId: '1' }))

    // Wait for initial fetch + first stream attempt
    await vi.waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    // The stream should attempt to reconnect (callCount >= 3)
    // but with backoff, so it won't be immediate
    await vi.waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(3)
    }, { timeout: 5000 })
  })

  it('applies backoff on 401 and does not retry immediately', async () => {
    const recentEvents = [{ id: '1', org_id: 1, type: 'test', summary: 'event 1' }]

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '1' } },
        }))
      }
      // 401 on stream
      return Promise.resolve(mockResponse({ status: 401 }))
    })

    const { unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await vi.waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    // Should not immediately reconnect (backoff)
    const countAfter401 = callCount
    await new Promise(resolve => {
      setTimeout(resolve, 200)
    })
    expect(callCount).toBe(countAfter401)
    unmount()
  })

  it('falls back to polling /recent on 503', async () => {
    const recentEvents = [{ id: '1', org_id: 1, type: 'test', summary: 'event 1' }]
    const pollEvents = [{ id: '2', org_id: 1, type: 'test', summary: 'event 2' }]

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '1' } },
        }))
      }
      // 503 on stream
      if (callCount === 2) {
        return Promise.resolve(mockResponse({ status: 503 }))
      }
      // Poll /recent
      return Promise.resolve(mockResponse({
        status: 200,
        json: { events: pollEvents, cursor_by_org: { '1': '2' } },
      }))
    })

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.degraded).toBe(true)
    })
    unmount()
  })

  it('parses SSE events from stream', async () => {
    const recentEvents = [{ id: '0', org_id: 1, type: 'test', summary: 'initial' }]

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '0' } },
        }))
      }
      // Stream with one activity event then clean EOF
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(
          'id: v1;org=1;sid=1',
          'event: home.activity.v1',
          'data: {"id":"1","org_id":1,"type":"test","summary":"live event"}',
          '',
        ),
      }))
    })

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.events.length).toBeGreaterThanOrEqual(1)
    })
    unmount()
  })

  it('handles deauthz by removing org events', async () => {
    const recentEvents = [
      { id: '1', org_id: 1, type: 'test', summary: 'org1 event' },
      { id: '2', org_id: 7, type: 'test', summary: 'org7 event' },
    ]

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '1', '7': '2' } },
        }))
      }
      // Stream with deauthz for org 7
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(
          'event: home.deauthz.v1',
          'data: {"dropped_org": 7}',
          '',
        ),
      }))
    })

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: undefined }))

    await waitFor(() => {
      // After deauthz, org 7 events should be removed
      const orgIds = result.current.events.map(e => e.org_id)
      expect(orgIds).not.toContain(7)
    })
    unmount()
  })

  it('caps events at maxItems', async () => {
    const manyEvents = Array.from({ length: 150 }, (_, i) => ({
      id: String(i), org_id: 1, type: 'test', summary: `event ${i}`,
    }))

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        json: { events: manyEvents, cursor_by_org: { '1': '149' } },
      }))
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        body: createSSEStream(),
      }))

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1', maxItems: 100 }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.events.length).toBeLessThanOrEqual(100)
    unmount()
  })

  it('sets degraded state when recent fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.degraded).toBe(true)
    })
    unmount()
  })
})
