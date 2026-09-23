import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'
import { usePageVisible } from './usePageVisible'

/**
 * Org-progress dashboard data from the home BFF (`GET /api/home/progress`).
 *
 * Contract:
 *   { generated_at, org_id, refreshing?, retry_after_seconds?,
 *     widget: { status, as_of?, data? } }
 *   where widget.data (when status="ok") is pulse's org_progress payload:
 *   { project, timeseries: { hours, buckets, bucket_minutes,
 *                            points: [{ ts, created, completed, terminal }],
 *                            totals: { created, completed, terminal } },
 *     by_status: { <slug>: count }, throughput: [{ team, status, samples,
 *     avg_dwell_seconds, p90_dwell_seconds, throughput_out_per_day }],
 *     open_dwell: same shape, current open-interval dwell (slowest-stages tile),
 *     snapshot: { open, blocked, in_progress, overdue,
 *                 completed_window, created_window, terminal_window } }
 *
 * The widget carries its own status (ok | degraded | stale | unauthorized |
 * empty) so the panel renders each state without ever blocking the page
 * (async-frontends doctrine). The BFF returns a fail-soft envelope; before the
 * endpoint deploys it 404s → we surface `degraded` rather than crashing.
 *
 * @param {{ orgId: number|string, hours?: number, buckets?: number,
 *           days?: number, refreshMs?: number, enabled?: boolean }} opts
 */
export const PROGRESS_ENDPOINT = '/api/home/progress'

// Memory only: never persist an organization's metrics across browser sessions.
// Exact access-token scope also separates refreshed authorization claims.
const lastGood = new Map()
const MAX_CACHED_WINDOWS = 32

function remember(key, token, orgId, payload) {
  lastGood.delete(key)
  lastGood.set(key, { token, orgId: String(orgId), payload })
  while (lastGood.size > MAX_CACHED_WINDOWS) lastGood.delete(lastGood.keys().next().value)
}

function forgetOrg(token, orgId) {
  for (const [key, entry] of lastGood) {
    if (entry.token === token && entry.orgId === String(orgId)) lastGood.delete(key)
  }
}

function cachedPayload(key) {
  const payload = lastGood.get(key)?.payload
  return payload ? { ...payload, widget: { ...payload.widget, status: 'stale' } } : null
}

export function useOrgProgress({
  orgId,
  hours = 24,
  buckets = 24,
  days = 7,
  refreshMs = 45000,
  enabled = true,
} = {}) {
  const pageVisible = usePageVisible()
  const [, authChanged] = useState(0)
  const token = getAccessToken()
  const allowed = enabled && !!token && orgId !== undefined && orgId !== null && orgId !== ''
  const key = allowed ? JSON.stringify([token, String(orgId), hours, buckets, days]) : null
  const [state, setState] = useState(null)
  const activeKey = useRef(key)
  activeKey.current = key
  const request = useRef(null)

  useEffect(() => {
    const syncAuth = () => {
      lastGood.clear()
      request.current?.controller.abort()
      request.current = null
      setState(null)
      authChanged((revision) => revision + 1)
    }
    const storageChanged = (event) => {
      if (event.key === null || event.key === 'shizuha_access_token') syncAuth()
    }
    window.addEventListener('shizuha-auth-cleared', syncAuth)
    window.addEventListener('shizuha-auth-refreshed', syncAuth)
    window.addEventListener('storage', storageChanged)
    return () => {
      window.removeEventListener('shizuha-auth-cleared', syncAuth)
      window.removeEventListener('shizuha-auth-refreshed', syncAuth)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  const load = useCallback(() => {
    if (!key || document.visibilityState === 'hidden') return Promise.resolve()
    // A slow refresh must finish; a timer or click must not abort/restart it.
    if (request.current?.key === key) return request.current.promise
    request.current?.controller.abort()
    const controller = new AbortController()
    const current = () => activeKey.current === key && !controller.signal.aborted && getAccessToken() === token
    setState((previous) => ({
      key, payload: previous?.key === key ? previous.payload : cachedPayload(key),
      error: null, loading: true,
    }))
    const promise = (async () => {
      try {
        const qs = new URLSearchParams({ org_id: String(orgId), hours: String(hours), buckets: String(buckets), days: String(days) })
        const resp = await fetch(`${PROGRESS_ENDPOINT}?${qs}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        })
        if (!current()) return
        if (resp.status === 401 || resp.status === 403) {
          forgetOrg(token, orgId)
          setState({ key, payload: { widget: { status: 'unauthorized' } }, error: null, loading: false })
          handleUnauthorized(resp)
          return
        }
        if (!resp.ok) throw new Error(`home progress ${resp.status}`)
        const json = await resp.json()
        if (!current()) return
        if (json.org_id != null && String(json.org_id) !== String(orgId)) throw new Error('home progress scope mismatch')
        const widget = json.widget
        if (!widget || !['ok', 'stale', 'loading', 'degraded', 'unauthorized', 'empty'].includes(widget.status)) {
          throw new Error('home progress invalid response')
        }
        let payload = json
        if (widget.status === 'unauthorized') {
          forgetOrg(token, orgId)
          payload = { ...json, widget: { status: 'unauthorized' } }
        } else if (widget.status === 'empty') {
          lastGood.delete(key)
        } else if (['ok', 'stale'].includes(widget.status) && widget.data) {
          remember(key, token, orgId, json)
        } else {
          if (widget.status === 'ok') throw new Error('home progress missing data')
          // A fail-soft HTTP 200 is still a refresh failure, not a new empty chart.
          const cached = cachedPayload(key)
          payload = cached ? { ...cached, refreshing: json.refreshing, retry_after_seconds: json.retry_after_seconds } : json
        }
        setState({ key, payload, error: null, loading: false })
      } catch (error) {
        if (!current() || error.name === 'AbortError') return
        setState({ key, payload: cachedPayload(key), error, loading: false })
      } finally {
        if (request.current?.controller === controller) request.current = null
        if (current()) setState((previous) => previous?.key === key ? { ...previous, loading: false } : previous)
      }
    })()
    request.current = { key, controller, promise }
    return promise
  }, [key, token, orgId, hours, buckets, days])

  useEffect(() => () => {
    if (request.current?.key === key) {
      request.current.controller.abort()
      request.current = null
    }
  }, [key, load])

  useEffect(() => {
    if (!pageVisible) return undefined
    load()
    const timer = key && refreshMs ? setInterval(load, refreshMs) : null
    return () => { if (timer) clearInterval(timer) }
  }, [key, load, refreshMs, pageVisible])

  // Select during render, not in an effect: never show the previous org/window
  // for even the first render after a scope change.
  const visible = key && state?.key === key ? state : null
  // Follow only an explicit pending-read completion hint from the BFF. Once
  // complete, ordinary refresh cadence resumes; failures do not spin retries.
  const retryAfter = Number(visible?.payload?.retry_after_seconds)
  const pending = visible?.payload?.refreshing === true
  const fetching = visible?.loading ?? !!key
  useEffect(() => {
    if (!pageVisible || !key || fetching || !pending || !Number.isFinite(retryAfter) || retryAfter <= 0) return undefined
    const timer = setTimeout(load, retryAfter * 1000)
    return () => clearTimeout(timer)
  }, [key, fetching, pending, retryAfter, load, pageVisible])

  const payload = key ? (visible?.payload ?? cachedPayload(key)) : null
  const widget = payload?.widget ?? null
  const error = visible?.error ?? null
  return {
    payload, widget,
    status: !token ? 'unauthorized' : widget?.status ?? (error ? 'degraded' : 'loading'),
    data: ['ok', 'stale'].includes(widget?.status) ? widget.data ?? null : null,
    loading: !!key && (fetching || pending),
    error, refresh: load,
  }
}
