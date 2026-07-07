import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

/**
 * HIVE-376 / HIVE-375: fetch the command-center `HomeSummaryV1` from the home
 * aggregation BFF (`GET /api/home/summary`). Contract (aoi-approved on HIVE-375):
 *
 *   { version: 1, generated_at, org_id,
 *     orgs: [{ id, name, role }],
 *     widgets: {
 *       agent_activity:       { status, as_of, data },
 *       tasks_by_status:      { status, as_of, data },
 *       financial_snapshot:   { status, as_of, data },   // status="unauthorized" hides P&L
 *       alerts:               { status, as_of, data },
 *       recent_conversations: { status, as_of, data },
 *     } }
 *
 * Each widget carries its own `status` (ok | degraded | stale | unauthorized |
 * empty) so the UI hydrates each independently and NEVER blocks the page — the
 * async-frontends doctrine. The BFF always returns 200 (partial); a slow/failed
 * source degrades ONE widget, not the whole call. Until the HIVE-375 backend
 * lands, the endpoint 404s / errors → we surface every widget as `degraded`
 * (loading state) rather than crashing, so this frontend ships in parallel.
 */

export const SUMMARY_ENDPOINT = '/api/home/summary'

// The widget keys the dashboard renders, in display order.
export const WIDGET_KEYS = [
  'agent_activity',
  'tasks_by_status',
  'financial_snapshot',
  'alerts',
  'recent_conversations',
]

/**
 * @param {{ orgId?: string, refreshMs?: number }} [opts]
 * @returns {{ summary: object|null, loading: boolean, error: Error|null,
 *   widget: (key: string) => {status: string, as_of?: string, data?: any},
 *   refresh: () => void }}
 */
export function useHomeSummary({ orgId, refreshMs = 30000 } = {}) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''
      const resp = await fetch(SUMMARY_ENDPOINT + qs, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal: controller.signal,
      })
      if (handleUnauthorized(resp)) return
      if (!resp.ok) {
        // Backend not deployed yet / transient failure — degrade, don't crash.
        throw new Error(`home summary ${resp.status}`)
      }
      const json = await resp.json()
      setSummary(json)
      setError(null)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    load()
    if (!refreshMs) return () => abortRef.current?.abort()
    const t = setInterval(load, refreshMs)
    return () => {
      clearInterval(t)
      abortRef.current?.abort()
    }
  }, [load, refreshMs])

  // widget(key): resolve a widget's envelope, defaulting to a safe status so the
  // UI always has something to render (skeleton while loading, degraded on error).
  const widget = useCallback(
    (key) => {
      const w = summary?.widgets?.[key]
      if (w && typeof w.status === 'string') return w
      if (loading) return { status: 'loading' }
      return { status: 'degraded' }
    },
    [summary, loading],
  )

  return { summary, loading, error, widget, refresh: load }
}
