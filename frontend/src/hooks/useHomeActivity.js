import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

/**
 * HIVE-602: poll the live-theater feed (`GET /api/home/activity`) — the
 * merged Pulse event stream (activity + comments across the caller's orgs)
 * plus the fleet as live entities. Fast cadence (default 8s) so the home
 * reads as live; same fail-soft widget envelope as useHomeSummary, so a slow
 * source degrades to recent history, never a blank or a crash.
 */

export const ACTIVITY_ENDPOINT = '/api/home/activity'

export function useHomeActivity({ orgId, refreshMs = 8000 } = {}) {
  const [activity, setActivity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''
      const resp = await fetch(ACTIVITY_ENDPOINT + qs, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal: controller.signal,
      })
      if (handleUnauthorized(resp)) return
      if (!resp.ok) throw new Error(`activity fetch failed: ${resp.status}`)
      setActivity(await resp.json())
      setError(null)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    load()
    if (!refreshMs) return undefined
    const id = setInterval(load, refreshMs)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [load, refreshMs])

  const widget = useCallback(
    (key) => {
      const w = activity?.widgets?.[key]
      if (w) return w
      return { status: loading ? 'loading' : 'degraded' }
    },
    [activity, loading],
  )

  return { activity, loading, error, widget, refresh: load }
}
