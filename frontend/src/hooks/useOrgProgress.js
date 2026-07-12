import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

/**
 * Org-progress dashboard data from the home BFF (`GET /api/home/progress`).
 *
 * Contract:
 *   { generated_at, org_id,
 *     widget: { status, as_of?, data? } }
 *   where widget.data (when status="ok") is pulse's org_progress payload:
 *   { project, timeseries: { hours, buckets, bucket_minutes,
 *                            points: [{ ts, created, completed, terminal }],
 *                            totals: { created, completed, terminal } },
 *     by_status: { <slug>: count }, throughput: [{ team, status, samples,
 *     avg_dwell_seconds, p90_dwell_seconds, throughput_out_per_day }],
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

export function useOrgProgress({
  orgId,
  hours = 24,
  buckets = 24,
  days = 7,
  refreshMs = 45000,
  enabled = true,
} = {}) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    if (!enabled || orgId === undefined || orgId === null || orgId === '') {
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        org_id: String(orgId),
        hours: String(hours),
        buckets: String(buckets),
        days: String(days),
      }).toString()
      const resp = await fetch(`${PROGRESS_ENDPOINT}?${qs}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal: controller.signal,
      })
      if (handleUnauthorized(resp)) return
      if (!resp.ok) throw new Error(`home progress ${resp.status}`)
      const json = await resp.json()
      setPayload(json)
      setError(null)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [orgId, hours, buckets, days, enabled])

  useEffect(() => {
    load()
    if (!refreshMs || !enabled) return () => abortRef.current?.abort()
    const t = setInterval(load, refreshMs)
    return () => {
      clearInterval(t)
      abortRef.current?.abort()
    }
  }, [load, refreshMs, enabled])

  const widget = payload?.widget ?? null
  return {
    payload,
    widget,
    status: widget?.status ?? (error ? 'degraded' : 'loading'),
    data: widget?.status === 'ok' ? widget.data : null,
    loading,
    error,
    refresh: load,
  }
}
