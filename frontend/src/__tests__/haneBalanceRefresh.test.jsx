import React from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHaneBalance } from '../hooks/useHaneBalance'
import HaneChip from '../components/shared/HaneChip'

vi.mock('../utils/auth', async (original) => ({ ...await original(), handleUnauthorized: vi.fn() }))
const reply = (available, status = 200) => ({ status, ok: status < 400, json: async () => ({ available, fiat: { label: '$12.50' }, observed_at: '2026-09-23T12:00:00Z' }) })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const advance = (ms = 30000) => act(() => vi.advanceTimersByTimeAsync(ms))
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.setItem('shizuha_access_token', 'hane-session-a')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  global.fetch = vi.fn().mockResolvedValue(reply(12.5))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

describe('Hane real component refresh sequence', () => {
  it('initializes once, then repeatedly reads the balance-only projection without page reload', async () => {
    fetch.mockResolvedValueOnce(reply(12.5)).mockResolvedValueOnce(reply(24)).mockResolvedValueOnce(reply(0))
    render(<HaneChip />); await flush()
    expect(screen.getByRole('link').title).toContain('12.5 Hane')
    await advance()
    expect(screen.getByRole('link').title).toContain('24 Hane')
    await advance()
    expect(screen.getByRole('link').title).toContain('0 Hane')
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/v1/hane', '/v1/hane?view=balance', '/v1/hane?view=balance'])
    expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true)
  })

  it('keeps the exact last-good balance and clock on transport/503 failure, then recovers', async () => {
    fetch.mockResolvedValueOnce(reply(12.5)).mockResolvedValueOnce(reply(null, 503)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply(20))
    render(<HaneChip />); await flush()
    const first = screen.getByRole('link').title
    await advance()
    expect(screen.getByRole('link')).toHaveAttribute('data-balance-state', 'stale')
    expect(screen.getByRole('link').title).toContain('Last known balance')
    expect(screen.getByRole('link').title.split(' · checked ')[1]).toBe(first.split(' · checked ')[1])
    await advance()
    expect(screen.getByRole('link').title).toContain('12.5 Hane')
    await advance()
    expect(screen.getByRole('link')).toHaveAttribute('data-balance-state', 'ok')
    expect(screen.getByRole('link').title).toContain('20 Hane')
  })

  it.each([401, 403])('clears the prior balance on %s and never restores it after a later outage', async (status) => {
    fetch.mockResolvedValueOnce(reply(12.5)).mockResolvedValueOnce(reply(null, status)).mockResolvedValue(reply(null, 503))
    render(<HaneChip />); await flush(); await advance()
    expect(screen.getByRole('link')).toHaveAttribute('data-balance-state', 'denied')
    expect(screen.queryByText('12.5')).toBeNull()
    await advance()
    expect(screen.queryByText('12.5')).toBeNull()
  })

  it('clears an explicitly missing purse instead of retaining an old balance', async () => {
    fetch.mockResolvedValueOnce(reply(12.5)).mockResolvedValueOnce(reply(null, 404)).mockResolvedValue(reply(null, 503))
    render(<HaneChip />); await flush(); await advance()
    expect(screen.queryByText('12.5')).toBeNull()
    expect(screen.getByRole('link').title).toContain('Balance unavailable')
    await advance()
    expect(screen.queryByText('12.5')).toBeNull()
  })

  it.each([null, '4', NaN, Infinity, -1])('rejects malformed available %s without fabricating zero', async (value) => {
    fetch.mockResolvedValue(reply(value))
    render(<HaneChip />); await flush()
    expect(screen.getByRole('link').title).toContain('Balance unavailable')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('coalesces slow requests, pauses hidden refreshes, and rearms on becoming visible', async () => {
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise)
    render(<HaneChip />); await flush(); await advance(90000)
    act(() => window.dispatchEvent(new Event('focus')))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(reply(7)))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await advance(90000)
    expect(fetch).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange'))); await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    await advance()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('clears auth scope immediately and suppresses a late old-user response', async () => {
    const late = deferred()
    fetch.mockResolvedValueOnce(reply(12.5)).mockReturnValueOnce(late.promise).mockResolvedValue(reply(99))
    const { result } = renderHook(() => useHaneBalance())
    await flush(); await advance()
    localStorage.setItem('shizuha_access_token', 'hane-session-b')
    act(() => window.dispatchEvent(new Event('shizuha-auth-refreshed')))
    expect(result.current.data).toBeUndefined()
    await flush(); expect(result.current.data.available).toBe(99)
    await act(async () => late.resolve(reply(777)))
    expect(result.current.data.available).toBe(99)
    localStorage.removeItem('shizuha_access_token')
    act(() => window.dispatchEvent(new Event('shizuha-auth-cleared')))
    expect(result.current.data).toBeUndefined()
    await advance(90000)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('aborts owned in-flight work and removes timers on unmount', async () => {
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise)
    const { unmount } = render(<HaneChip />)
    const signal = fetch.mock.calls[0][1].signal
    unmount(); expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(reply(8)))
    await advance(90000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
