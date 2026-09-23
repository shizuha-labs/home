import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useHomeSummary } from '../hooks/useHomeSummary'

vi.mock('../utils/auth', async (original) => ({ ...await original(), handleUnauthorized: vi.fn() }))
const reply = (data, status = 200) => ({ status, ok: status < 400, json: async () => data })
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const summary = (org = 1) => ({ org_id: org, orgs: [{ id: org }], widgets: {
  tasks_by_status: { status: 'ok', as_of: '2026-09-23T08:00:00Z', data: { open: 17 } },
  financial_snapshot: { status: 'loading' },
} })
const financial = (org = 1) => ({ org_id: org, widget: { status: 'ok', data: { org_id: org, cash: 42 } } })
let session = 0
beforeEach(() => { localStorage.setItem('shizuha_access_token', `finance-session-${++session}`); global.fetch = vi.fn() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('shows orgs/nonfinancial widgets before slow Books authorization completes', async () => {
  const money = deferred()
  fetch.mockImplementation((url) => url.startsWith('/api/home/financial') ? money.promise : Promise.resolve(reply(summary())))
  const { result } = renderHook(() => useHomeSummary({ orgId: 1, refreshMs: 0 }))
  await waitFor(() => expect(result.current.summary?.orgs).toEqual([{ id: 1 }]))
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/home/summary?background=1&org_id=1', '/api/home/financial?org_id=1'])
  expect(result.current.loading).toBe(false)
  expect(result.current.widget('tasks_by_status').data.open).toBe(17)
  expect(result.current.widget('financial_snapshot').status).toBe('loading')
  await act(async () => money.resolve(reply(financial())))
  expect(result.current.widget('financial_snapshot').data.cash).toBe(42)
})

it.each([403, 500])('does not retain finance during a failed fresh authorization/read (%s), while other widgets stay', async (status) => {
  const money = vi.fn().mockResolvedValueOnce(reply(financial())).mockResolvedValueOnce(reply({}, status))
  fetch.mockImplementation((url) => url.startsWith('/api/home/financial') ? money() : Promise.resolve(reply(summary())))
  const { result, unmount } = renderHook(() => useHomeSummary({ orgId: 1, refreshMs: 0 }))
  await waitFor(() => expect(result.current.widget('financial_snapshot').data?.cash).toBe(42))
  await act(() => result.current.refresh())
  expect(result.current.widget('financial_snapshot').data).toBeUndefined()
  expect(result.current.widget('financial_snapshot').status).toBe(status === 403 ? 'unauthorized' : 'degraded')
  expect(result.current.widget('tasks_by_status').data.open).toBe(17)
  unmount()
  money.mockReturnValue(new Promise(() => {}))
  const next = renderHook(() => useHomeSummary({ orgId: 1, refreshMs: 0 }))
  expect(next.result.current.widget('financial_snapshot').data).toBeUndefined()
})

it('fences finance by org and login, including late old authorization results', async () => {
  const first = deferred(), next = deferred()
  const money = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise).mockReturnValue(new Promise(() => {}))
  fetch.mockImplementation((url) => url.startsWith('/api/home/financial') ? money() : Promise.resolve(reply(summary(Number(new URL(url, 'https://home.test').searchParams.get('org_id'))))))
  const { result, rerender } = renderHook((props) => useHomeSummary({ ...props, refreshMs: 0 }), { initialProps: { orgId: 1 } })
  await waitFor(() => expect(result.current.summary?.org_id).toBe(1))
  rerender({ orgId: 2 })
  await act(async () => first.resolve(reply(financial(1))))
  expect(result.current.widget('financial_snapshot').data).toBeUndefined()
  await act(async () => next.resolve(reply(financial(2))))
  expect(result.current.widget('financial_snapshot').data.org_id).toBe(2)
  act(() => {
    localStorage.setItem('shizuha_access_token', 'new-finance-login')
    window.dispatchEvent(new Event('shizuha-auth-refreshed'))
  })
  expect(result.current.widget('financial_snapshot').data).toBeUndefined()
})

it('follows pending summary completion without multiplying independent fresh finance requests', async () => {
  vi.useFakeTimers()
  const feed = vi.fn().mockResolvedValueOnce(reply({ org_id: 1, orgs: [], refreshing: true, retry_after_seconds: 1, widgets: { tasks_by_status: { status: 'loading' } } }))
    .mockResolvedValueOnce(reply({ ...summary(), refreshing: false }))
  const money = vi.fn().mockResolvedValue(reply(financial()))
  fetch.mockImplementation((url) => url.startsWith('/api/home/financial') ? money() : feed())
  const { result } = renderHook(() => useHomeSummary({ orgId: 1, refreshMs: 0 }))
  await act(async () => {})
  expect(result.current.loading).toBe(true)
  await act(async () => vi.advanceTimersByTime(1000))
  expect(result.current.widget('tasks_by_status').data.open).toBe(17)
  expect(result.current.loading).toBe(false)
  expect(feed).toHaveBeenCalledTimes(2)
  expect(money).toHaveBeenCalledTimes(1)
})
