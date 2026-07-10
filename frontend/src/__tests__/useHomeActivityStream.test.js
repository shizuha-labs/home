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

import { getAccessToken } from '../utils/auth'

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

// Helper: create a stream that stays open (never closes)
function createOpenStream() {
  return new ReadableStream({
    start() {
      // Never close — keeps the hook in streaming state
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
      // Stream stays open so hook doesn't enter backoff loop
      .mockResolvedValueOnce(mockResponse({
        status: 200,
        body: createOpenStream(),
      }))

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.events).toEqual(recentEvents)
    unmount()
  })

  it('deduplicates duplicate SSE events by (org_id, id)', async () => {
    const recentEvents = [{ id: '1', org_id: 1, type: 'test', summary: 'initial' }]

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(mockResponse({
          status: 200,
          json: { events: recentEvents, cursor_by_org: { '1': '1' } },
        }))
      }
      // Stream sends the SAME event twice then stays open
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(
          'id: v1;org=1;sid=2',
          'event: home.activity.v1',
          'data: {"id":"1","org_id":1,"type":"test","summary":"initial"}',
          '',
          'id: v1;org=1;sid=3',
          'event: home.activity.v1',
          'data: {"id":"1","org_id":1,"type":"test","summary":"initial"}',
          '',
        ),
      }))
    })

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await waitFor(() => {
      // Should have only the initial event (duplicate SSE event is deduped)
      expect(result.current.events.length).toBe(1)
    })
    unmount()
  })

  it('applies exponential backoff on clean EOF (no events received)', async () => {
    vi.useFakeTimers()
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
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(),
      }))
    })

    renderHook(() => useHomeActivityStream({ orgId: '1' }))

    // Let initial render + fetch + first stream attempt complete
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(callCount).toBeGreaterThanOrEqual(2)

    // Advance 500ms — backoff is 1s base, so no reconnect yet
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(callCount).toBe(2)

    // Advance past 1s — first reconnect should fire
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(callCount).toBeGreaterThanOrEqual(3)

    // Second EOF: backoff should be 2s now
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(callCount).toBe(3)

    // Advance past 2s — second reconnect
    await act(async () => { vi.advanceTimersByTime(1600) })
    expect(callCount).toBeGreaterThanOrEqual(4)

    vi.useRealTimers()
  })

  it('applies backoff on 401 and does not retry immediately', async () => {
    vi.useFakeTimers()
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
      return Promise.resolve(mockResponse({ status: 401 }))
    })

    const { unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(callCount).toBeGreaterThanOrEqual(2)

    // Should not reconnect within 500ms (backoff is 1s base)
    const countAfter401 = callCount
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(callCount).toBe(countAfter401)
    unmount()
    vi.useRealTimers()
  })

  it('falls back to polling /recent on 503 and reconnects', async () => {
    vi.useFakeTimers()
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
      if (callCount === 2) {
        return Promise.resolve(mockResponse({ status: 503 }))
      }
      return Promise.resolve(mockResponse({
        status: 200,
        json: { events: pollEvents, cursor_by_org: { '1': '2' } },
      }))
    })

    const { result, unmount } = renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(result.current.degraded).toBe(true)

    // Advance past 15s poll interval — should trigger /recent poll
    await act(async () => { vi.advanceTimersByTime(16000) })
    expect(callCount).toBeGreaterThanOrEqual(3)
    unmount()
    vi.useRealTimers()
  })

  it('parses SSE events from stream and adds them to state', async () => {
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
      expect(result.current.events.length).toBe(2)
      const liveEvent = result.current.events.find(e => e.id === '1')
      expect(liveEvent).toBeTruthy()
      expect(liveEvent.summary).toBe('live event')
    })
    unmount()
  })

  it('acquires fresh token on each reconnect attempt', async () => {
    vi.useFakeTimers()
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
      return Promise.resolve(mockResponse({ status: 401 }))
    })

    renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(callCount).toBeGreaterThanOrEqual(2)

    // getAccessToken was called at least once (for the stream attempt)
    expect(getAccessToken).toHaveBeenCalled()

    // Advance past backoff — should call getAccessToken again
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(callCount).toBeGreaterThanOrEqual(3)

    // getAccessToken was called again for the new stream attempt
    expect(getAccessToken).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('applies backoff on home.reconnect.v1 signal', async () => {
    vi.useFakeTimers()
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
      return Promise.resolve(mockResponse({
        status: 200,
        body: createSSEStream(
          'event: home.reconnect.v1',
          'data: {"reason": "lifetime"}',
          '',
        ),
      }))
    })

    renderHook(() => useHomeActivityStream({ orgId: '1' }))

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(callCount).toBeGreaterThanOrEqual(2)

    // Should not reconnect immediately (backoff)
    const countAfterReconnect = callCount
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(callCount).toBe(countAfterReconnect)

    // Advance past 1s backoff — should reconnect
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(callCount).toBeGreaterThanOrEqual(3)
    vi.useRealTimers()
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
        body: createOpenStream(),
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
