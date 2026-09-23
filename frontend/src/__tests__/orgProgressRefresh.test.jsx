import React from 'react'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOrgProgress } from '../hooks/useOrgProgress'
import OrgProgressCharts from '../components/dashboard/OrgProgressCharts'

vi.mock('../utils/auth', async (original) => ({
  ...await original(),
  handleUnauthorized: vi.fn((response) => response.status === 401),
}))

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const good = (org = 1, count = 17, status = 'ok') => ({
  org_id: org, generated_at: '2026-09-23T08:00:00Z',
  widget: { status, as_of: '2026-09-23T07:59:00Z', data: {
    snapshot: { completed_window: count, created_window: 8, in_progress: 2, blocked: 0 },
    timeseries: { points: [] }, by_status: { in_progress: 2 },
  } },
})
const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => json })
const hook = (props = {}) => renderHook((options) => useOrgProgress({ refreshMs: 0, ...options }), { initialProps: { orgId: 1, ...props } })
let session = 0
beforeEach(() => {
  localStorage.setItem('shizuha_access_token', `progress-session-${++session}`)
  global.fetch = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Org progress real caller refresh lifecycle', () => {
  it('renders source stale data and preserves its observation time', async () => {
    fetch.mockResolvedValue(response(good(1, 17, 'stale')))
    const { result } = hook()
    await waitFor(() => expect(result.current.data?.snapshot.completed_window).toBe(17))
    expect(result.current.status).toBe('stale')
    expect(result.current.widget.as_of).toBe('2026-09-23T07:59:00Z')
  })

  it('keeps last good through degraded HTTP 200 and network error, then recovers on the next refresh', async () => {
    fetch.mockResolvedValueOnce(response(good()))
      .mockResolvedValueOnce(response({ org_id: 1, widget: { status: 'degraded' } }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(good(1, 22)))
    const { result } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    await act(() => result.current.refresh())
    expect(result.current.status).toBe('stale')
    expect(result.current.data.snapshot.completed_window).toBe(17)
    await act(() => result.current.refresh())
    expect(result.current.status).toBe('stale')
    expect(result.current.widget.as_of).toBe('2026-09-23T07:59:00Z')
    await act(() => result.current.refresh())
    expect(result.current.status).toBe('ok')
    expect(result.current.data.snapshot.completed_window).toBe(22)
  })

  it('never shows prior org/range data and serves an exact cached revisit before its response', async () => {
    const orgTwo = deferred(), sevenDays = deferred(), revisit = deferred()
    fetch.mockResolvedValueOnce(response(good())).mockReturnValueOnce(orgTwo.promise)
      .mockReturnValueOnce(sevenDays.promise).mockReturnValueOnce(revisit.promise)
    const { result, rerender } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    rerender({ orgId: 2 })
    expect(result.current.data).toBeNull()
    await act(async () => orgTwo.resolve(response(good(2, 29))))
    rerender({ orgId: 1, hours: 168, buckets: 42 })
    expect(result.current.data).toBeNull()
    await act(async () => sevenDays.resolve(response(good(1, 71))))
    rerender({ orgId: 1, hours: 24, buckets: 24 })
    expect(result.current.data.snapshot.completed_window).toBe(17)
    expect(result.current.status).toBe('stale')
    expect(result.current.loading).toBe(true)
    await act(async () => revisit.resolve(response(good(1, 18))))
    expect(result.current.data.snapshot.completed_window).toBe(18)
  })

  it('reuses a cached window on remount but not under another login', async () => {
    const pending = deferred()
    fetch.mockResolvedValueOnce(response(good())).mockReturnValue(pending.promise)
    const first = hook()
    await waitFor(() => expect(first.result.current.status).toBe('ok'))
    first.unmount()
    const second = hook()
    expect(second.result.current.data.snapshot.completed_window).toBe(17)
    second.unmount()
    localStorage.setItem('shizuha_access_token', 'other-login')
    const other = hook()
    expect(other.result.current.data).toBeNull()
  })

  it('ignores an aborted old response and its finally while the new selection is still loading', async () => {
    const old = deferred(), next = deferred()
    fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const { result, rerender } = hook()
    rerender({ orgId: 2 })
    await act(async () => old.resolve(response(good())))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => next.resolve(response(good(2, 29))))
    expect(result.current.data.snapshot.completed_window).toBe(29)
  })

  it('also fences a late JSON body, even when fetch finished before changing scopes', async () => {
    const body = deferred(), next = deferred()
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise }).mockReturnValueOnce(next.promise)
    const { result, rerender } = hook()
    await act(async () => {})
    rerender({ orgId: 2 })
    await act(async () => body.resolve(good()))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => next.resolve(response(good(2, 29))))
    expect(result.current.data.snapshot.completed_window).toBe(29)
  })

  it.each([401, 403, 'envelope'])('clears cached access on %s, including other windows of that org', async (denial) => {
    fetch.mockResolvedValueOnce(response(good())).mockResolvedValueOnce(response(good(1, 71)))
      .mockResolvedValueOnce(denial === 'envelope'
        ? response({ org_id: 1, widget: { status: 'unauthorized', data: good().widget.data } })
        : response({}, denial))
      .mockReturnValue(new Promise(() => {}))
    const { result, rerender } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    rerender({ orgId: 1, hours: 168, buckets: 42 })
    await waitFor(() => expect(result.current.data?.snapshot.completed_window).toBe(71))
    await act(() => result.current.refresh())
    expect(result.current.status).toBe('unauthorized')
    expect(result.current.data).toBeNull()
    rerender({ orgId: 1, hours: 24, buckets: 24 })
    expect(result.current.data).toBeNull()
  })

  it('clears data synchronously on logout and ignores old-session results', async () => {
    const pending = deferred()
    fetch.mockResolvedValueOnce(response(good())).mockReturnValueOnce(pending.promise)
    const { result } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => { result.current.refresh() })
    act(() => {
      localStorage.removeItem('shizuha_access_token')
      window.dispatchEvent(new Event('shizuha-auth-cleared'))
    })
    expect(result.current.data).toBeNull()
    expect(result.current.status).toBe('unauthorized')
    await act(async () => pending.resolve(response(good(1, 999))))
    expect(result.current.data).toBeNull()
  })

  it('coalesces repeated timer/manual refreshes and rearms after completion', async () => {
    vi.useFakeTimers()
    const first = deferred(), second = deferred()
    fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = hook({ refreshMs: 45000 })
    act(() => { result.current.refresh(); vi.advanceTimersByTime(90000) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)
    await act(async () => first.resolve(response(good())))
    act(() => vi.advanceTimersByTime(45000))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data.snapshot.completed_window).toBe(17)
    await act(async () => second.resolve(response(good(1, 22))))
    expect(result.current.data.snapshot.completed_window).toBe(22)
  })

  it('completes an explicitly pending cold read promptly, then returns to ordinary refresh cadence', async () => {
    vi.useFakeTimers()
    fetch.mockResolvedValueOnce(response({ org_id: 1, refreshing: true, retry_after_seconds: 2, widget: { status: 'loading' } }))
      .mockResolvedValueOnce(response({ ...good(), refreshing: false }))
      .mockResolvedValue(response(good(1, 22)))
    const { result } = hook({ refreshMs: 45000 })
    await act(async () => {})
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => vi.advanceTimersByTime(2000))
    expect(result.current.data.snapshot.completed_window).toBe(17)
    expect(result.current.loading).toBe(false)
    await act(async () => vi.advanceTimersByTime(4000))
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTime(39000))
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result.current.data.snapshot.completed_window).toBe(22)
  })

  it('cancels a pending-read follow-up when changing org, disabling, or unmounting', async () => {
    vi.useFakeTimers()
    fetch.mockResolvedValue(response({ org_id: 1, refreshing: true, retry_after_seconds: 2, widget: { status: 'loading' } }))
    const { rerender, unmount, result } = hook()
    await act(async () => {})
    fetch.mockResolvedValue(response(good(2, 29)))
    rerender({ orgId: 2 })
    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(2000))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data.snapshot.completed_window).toBe(29)
    rerender({ orgId: 2, enabled: false })
    expect(result.current.data).toBeNull()
    unmount()
    await act(async () => vi.advanceTimersByTime(45000))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('pauses pending-read completion while hidden and refreshes immediately on return', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fetch.mockResolvedValueOnce(response({ org_id: 1, refreshing: true, retry_after_seconds: 1, widget: { status: 'loading' } }))
      .mockResolvedValueOnce(response(good()))
    const { result } = hook()
    await act(async () => {})
    act(() => {
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => vi.advanceTimersByTime(10000))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data.snapshot.completed_window).toBe(17)
  })

  it('accepts authoritative empty, and rejects a response for a different org', async () => {
    fetch.mockResolvedValueOnce(response(good())).mockResolvedValueOnce(response(good(2, 999)))
      .mockResolvedValueOnce(response({ org_id: 1, widget: { status: 'empty' } }))
    const { result } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    await act(() => result.current.refresh())
    expect(result.current.data.snapshot.completed_window).toBe(17)
    expect(result.current.status).toBe('stale')
    await act(() => result.current.refresh())
    expect(result.current.status).toBe('empty')
    expect(result.current.data).toBeNull()
  })

  it('bounds cached windows rather than retaining every visited org forever', async () => {
    fetch.mockImplementation(async (url) => response(good(Number(new URL(url, 'https://home.test').searchParams.get('org_id')))))
    const { result, rerender } = hook()
    await waitFor(() => expect(result.current.status).toBe('ok'))
    for (let orgId = 2; orgId <= 34; orgId++) {
      rerender({ orgId })
      await waitFor(() => expect(result.current.status).toBe('ok'))
    }
    fetch.mockReturnValue(new Promise(() => {}))
    rerender({ orgId: 1 })
    expect(result.current.data).toBeNull()
  })
})

describe('Org progress charts with the real hook', () => {
  it('keeps actual figures and as-of information visible during failure and recovers', async () => {
    fetch.mockResolvedValueOnce(response(good()))
      .mockResolvedValueOnce(response({ widget: { status: 'degraded' }, org_id: 1 }))
      .mockResolvedValueOnce(response(good(1, 22)))
    render(<OrgProgressCharts orgs={[{ id: 1 }]} orgId={1} range="24h" />)
    expect(await screen.findByText('17')).toBeVisible()
    await act(async () => screen.getByTitle('Refresh').click())
    expect(screen.getByText('17')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Showing the last available progress.')
    expect(screen.getByRole('status').querySelector('time')).toHaveAttribute('dateTime', '2026-09-23T07:59:00Z')
    expect(screen.queryByText('Progress metrics are temporarily unavailable.')).not.toBeInTheDocument()
    await act(async () => screen.getByTitle('Refresh').click())
    expect(screen.getByText('22')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('never renders healthy zero charts while an initial async result is pending', async () => {
    fetch.mockResolvedValue(response({ org_id: 1, widget: { status: 'loading' } }))
    render(<OrgProgressCharts orgs={[{ id: 1 }]} orgId={1} range="24h" />)
    await act(async () => {})
    expect(screen.getByRole('status', { name: 'Loading progress metrics' })).toBeVisible()
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
