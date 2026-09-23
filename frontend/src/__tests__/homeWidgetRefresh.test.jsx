import React from 'react'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHomeSummary } from '../hooks/useHomeSummary'
import { useHomeActivity } from '../hooks/useHomeActivity'
import LiveTheater from '../components/dashboard/LiveTheater'

vi.mock('../utils/auth', async (original) => ({ ...await original(), handleUnauthorized: vi.fn() }))
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const reply = (data, status = 200) => ({ status, ok: status < 400, json: async () => data })
const envelope = (org = 1, n = 17) => ({ org_id: org, widgets: {
  metric: { status: 'ok', as_of: '2026-09-23T07:59:00Z', data: { count: n } },
  secondary: { status: 'ok', data: [n] },
} })
let session = 0
let feedFetch
beforeEach(() => {
  localStorage.setItem('shizuha_access_token', `widget-session-${++session}`)
  feedFetch = vi.fn()
  global.fetch = vi.fn((url, ...args) => url.startsWith('/api/home/financial')
    ? Promise.resolve(reply({ widget: { status: 'empty', data: {} } })) : feedFetch(url, ...args))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

for (const [label, useFeed, payloadName] of [['summary', useHomeSummary, 'summary'], ['activity', useHomeActivity, 'activity']]) {
  describe(`${label} real widget caller`, () => {
    const mount = (props = {}) => renderHook((options) => useFeed({ refreshMs: 0, ...options }), { initialProps: { orgId: 1, ...props } })
    it('retains only the failed widget with original age, updates the healthy peer, then recovers', async () => {
      feedFetch.mockResolvedValueOnce(reply(envelope())).mockResolvedValueOnce(reply({ org_id: 1, widgets: {
        metric: { status: 'degraded', as_of: '2026-09-23T08:01:00Z' }, secondary: { status: 'ok', data: [28] },
      } })).mockResolvedValueOnce(reply(envelope(1, 29)))
      const { result } = mount()
      await waitFor(() => expect(result.current.widget('metric').status).toBe('ok'))
      await act(() => result.current.refresh())
      expect(result.current.widget('metric')).toEqual({ status: 'stale', as_of: '2026-09-23T07:59:00Z', data: { count: 17 } })
      expect(result.current.widget('secondary').data).toEqual([28])
      await act(() => result.current.refresh())
      expect(result.current.widget('metric').status).toBe('ok')
      expect(result.current.widget('metric').data.count).toBe(29)
    })
    it('marks transport failures stale and never restores denied or authoritative empty values', async () => {
      feedFetch.mockResolvedValueOnce(reply(envelope())).mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(reply({ org_id: 1, widgets: { metric: { status: 'unauthorized', data: { count: 999 } }, secondary: { status: 'empty', data: [] } } }))
        .mockResolvedValueOnce(reply({ org_id: 1, widgets: { metric: { status: 'degraded' }, secondary: { status: 'degraded' } } }))
      const { result } = mount()
      await waitFor(() => expect(result.current.widget('metric').status).toBe('ok'))
      await act(() => result.current.refresh())
      expect(result.current.widget('metric').status).toBe('stale')
      await act(() => result.current.refresh())
      expect(result.current.widget('metric')).toEqual({ status: 'unauthorized' })
      expect(result.current.widget('secondary').data).toEqual([])
      await act(() => result.current.refresh())
      expect(result.current.widget('metric')).toEqual({ status: 'degraded' })
      expect(result.current.widget('secondary').data).toEqual([])
    })
    it('isolates org and login scopes, but immediately reuses the exact prior scope', async () => {
      const wait = deferred()
      feedFetch.mockResolvedValueOnce(reply(envelope())).mockResolvedValueOnce(reply(envelope(2, 29))).mockReturnValue(wait.promise)
      const { result, rerender } = mount()
      await waitFor(() => expect(result.current.widget('metric').status).toBe('ok'))
      rerender({ orgId: 2 })
      expect(result.current[payloadName]).toBeNull()
      await waitFor(() => expect(result.current.widget('metric').data?.count).toBe(29))
      rerender({ orgId: 1 })
      expect(result.current.widget('metric').data.count).toBe(17)
      expect(result.current.widget('metric').status).toBe('stale')
      act(() => {
        localStorage.setItem('shizuha_access_token', 'new-login')
        window.dispatchEvent(new Event('shizuha-auth-refreshed'))
      })
      expect(result.current[payloadName]).toBeNull()
    })
    it.each([401, 403])('clears all snapshot widgets and revisits after HTTP %s', async (status) => {
      feedFetch.mockResolvedValueOnce(reply(envelope())).mockResolvedValueOnce(reply({}, status)).mockReturnValue(new Promise(() => {}))
      const first = mount()
      await waitFor(() => expect(first.result.current.widget('metric').status).toBe('ok'))
      await act(() => first.result.current.refresh())
      expect(first.result.current[payloadName]).toBeNull()
      expect(first.result.current.widget('metric').status).toBe('unauthorized')
      first.unmount()
      const next = mount()
      expect(next.result.current[payloadName]).toBeNull()
    })
    it('fences late bodies and cleanup, while completing the new scope request', async () => {
      const old = deferred(), next = deferred()
      feedFetch.mockResolvedValueOnce({ status: 200, ok: true, json: () => old.promise }).mockReturnValueOnce(next.promise)
      const { result, rerender } = mount()
      await act(async () => {})
      rerender({ orgId: 2 })
      await act(async () => old.resolve(envelope()))
      expect(result.current[payloadName]).toBeNull()
      expect(result.current.loading).toBe(true)
      await act(async () => next.resolve(reply(envelope(2, 29))))
      expect(result.current.widget('metric').data.count).toBe(29)
    })
    it('does not fetch a hidden page, resumes immediately, and pauses subsequent hidden intervals', async () => {
      vi.useFakeTimers()
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      feedFetch.mockResolvedValue(reply(envelope()))
      const { result } = mount({ refreshMs: 8000 })
      await act(async () => vi.advanceTimersByTime(24000))
      expect(feedFetch).not.toHaveBeenCalled()
      await act(async () => {
        visibility.mockReturnValue('visible')
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(feedFetch).toHaveBeenCalledTimes(1)
      expect(result.current.widget('metric').data.count).toBe(17)
      act(() => {
        visibility.mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => vi.advanceTimersByTime(24000))
      expect(feedFetch).toHaveBeenCalledTimes(1)
      await act(async () => {
        visibility.mockReturnValue('visible')
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(feedFetch).toHaveBeenCalledTimes(2)
    })
    it('coalesces slow automatic and manual refreshes, then rearms the next cycle', async () => {
      vi.useFakeTimers()
      const first = deferred(), next = deferred()
      feedFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
      const { result } = mount({ refreshMs: 8000 })
      act(() => { result.current.refresh(); vi.advanceTimersByTime(16000) })
      expect(feedFetch).toHaveBeenCalledTimes(1)
      expect(feedFetch.mock.calls[0][1].signal.aborted).toBe(false)
      await act(async () => first.resolve(reply(envelope())))
      act(() => vi.advanceTimersByTime(8000))
      expect(feedFetch).toHaveBeenCalledTimes(2)
      expect(result.current.widget('metric').data.count).toBe(17)
      await act(async () => next.resolve(reply(envelope(1, 28))))
      expect(result.current.widget('metric').data.count).toBe(28)
    })
  })
}

it('labels retained activity with its original observation instead of a LIVE badge', () => {
  const event = { id: 1, at: '2026-09-23T07:58:00Z', actor_email: 'agent@example.test', event: 'created', item_key: 'TEST-1', item_title: 'Activity fixture' }
  render(<LiveTheater feed={{ status: 'stale', as_of: '2026-09-23T07:59:00Z', data: [event] }} agents={{ status: 'empty', data: [] }} />)
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
  expect(screen.getByText('Last available data', { exact: false })).toBeVisible()
  expect(document.querySelector('time[datetime="2026-09-23T07:59:00Z"]')).not.toBeNull()
})
