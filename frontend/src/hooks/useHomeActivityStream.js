import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

/**
 * HIVE-603: Home live activity stream hook.
 *
 * Fetches recent activity history from GET /api/home/activity/recent, then
 * opens an authenticated fetch-stream SSE connection to /api/home/activity/stream
 * for live updates. Maintains per-org cursors for reconnect replay.
 *
 * Contract (HLD §4, §6, §7):
 *   - Initial fetch from /recent for bounded history
 *   - SSE stream via fetch() + ReadableStream (not native EventSource)
 *   - Deduplicate by (org_id, id)
 *   - Reconnect from last per-org cursor
 *   - Degraded/stale state when Redis is down
 *   - Never blocks dashboard render
 */

const RECENT_ENDPOINT = '/api/home/activity/recent'
const STREAM_ENDPOINT = '/api/home/activity/stream'
const MAX_ITEMS = 100
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

/**
 * @param {{ orgId?: string, maxItems?: number }} [opts]
 * @returns {{
 *   events: Array<object>,
 *   loading: boolean,
 *   error: Error|null,
 *   degraded: boolean,
 *   stale: boolean,
 * }}
 */
export function useHomeActivityStream({ orgId, maxItems = MAX_ITEMS } = {}) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [degraded, setDegraded] = useState(false)
  const [stale, setStale] = useState(false)

  // Per-org cursor map: { [orgId: string]: redisStreamId }
  const lastByOrgRef = useRef({})
  const reconnectAttemptRef = useRef(0)
  const abortRef = useRef(null)
  const streamActiveRef = useRef(false)

  // Build query string for recent/stream endpoints
  const buildQs = useCallback(({ since, sinceByOrg } = {}) => {
    const params = new URLSearchParams()
    if (orgId) {
      params.set('org_id', orgId)
      if (since) {
        params.set('since', since)
      } else if (sinceByOrg) {
        // Single-org reconnect: send since_by_org for the cursor
        params.set('since_by_org', sinceByOrg)
      }
    } else if (sinceByOrg) {
      params.set('since_by_org', sinceByOrg)
    }
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [orgId])

  // Encode per-org cursor map as base64url WITH padding
  const encodeCursorMap = useCallback((cursorMap) => {
    try {
      const json = JSON.stringify(cursorMap)
      let encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_')
      // Preserve padding — backend decode expects it
      return encoded
    } catch {
      return ''
    }
  }, [])

  // Fetch recent history
  const fetchRecent = useCallback(async () => {
    const qs = buildQs()
    try {
      const resp = await fetch(RECENT_ENDPOINT + qs, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      })
      if (handleUnauthorized(resp)) return null
      if (!resp.ok) {
        throw new Error(`activity recent ${resp.status}`)
      }
      const data = await resp.json()
      // Update per-org cursors from response
      if (data.cursor_by_org) {
        lastByOrgRef.current = { ...lastByOrgRef.current, ...data.cursor_by_org }
      }
      setDegraded(!!(data.degraded_sources?.length))
      return data.events || []
    } catch (e) {
      throw e
    }
  }, [buildQs])

  // Parse SSE stream from a ReadableStream
  const parseSSEStream = useCallback(async (response, onEvent, onCursor, onReconnect, onDeauthz) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = ''
    let currentId = ''
    let currentData = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('id: ')) {
            currentId = line.slice(4).trim()
          } else if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6).trim()
          } else if (line === '') {
            // Empty line = end of event
            if (currentEvent === 'home.activity.v1' && currentData) {
              try {
                const parsed = JSON.parse(currentData)
                onEvent(parsed, currentId)
              } catch { /* skip malformed */ }
            } else if (currentEvent === 'home.cursor.v1' && currentData) {
              try {
                const parsed = JSON.parse(currentData)
                if (parsed.cursor_by_org) {
                  onCursor(parsed.cursor_by_org)
                }
              } catch { /* skip malformed */ }
            } else if (currentEvent === 'home.reconnect.v1' && currentData) {
              try {
                const parsed = JSON.parse(currentData)
                onReconnect(parsed)
              } catch { /* skip malformed */ }
            } else if (currentEvent === 'home.deauthz.v1' && currentData) {
              try {
                const parsed = JSON.parse(currentData)
                onDeauthz(parsed)
              } catch { /* skip malformed */ }
            }
            // Heartbeat comments (line starting with ":") are ignored
            currentEvent = ''
            currentId = ''
            currentData = ''
          }
          // Lines starting with ":" are comments (heartbeats) — ignored
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') return
      throw e
    }
  }, [])

  // Open SSE stream
  const openStream = useCallback(async (signal) => {
    if (streamActiveRef.current) return
    streamActiveRef.current = true

    try {
      // Build cursor for reconnect
      let sinceByOrg
      if (orgId) {
        // Single-org: use the cursor for this org
        const cursor = lastByOrgRef.current[orgId]
        if (cursor) {
          sinceByOrg = encodeCursorMap({ [orgId]: cursor })
        }
      } else {
        // Aggregate: use full cursor map
        if (Object.keys(lastByOrgRef.current).length > 0) {
          sinceByOrg = encodeCursorMap(lastByOrgRef.current)
        }
      }

      const qs = buildQs({ sinceByOrg })
      const resp = await fetch(STREAM_ENDPOINT + qs, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal,
      })
      if (handleUnauthorized(resp)) {
        streamActiveRef.current = false
        return
      }
      if (!resp.ok) {
        throw new Error(`activity stream ${resp.status}`)
      }
      if (!resp.body) {
        throw new Error('No response body for stream')
      }

      // Reset reconnect backoff on successful connection
      reconnectAttemptRef.current = 0
      setStale(false)

      await parseSSEStream(
        resp,
        // onEvent: add event to state, deduplicate by (org_id, id)
        (parsed, compoundId) => {
          const eventOrgId = String(parsed.org_id || '')
          const eventId = parsed.id || ''

          // Update per-org cursor
          if (eventOrgId && eventId) {
            lastByOrgRef.current[eventOrgId] = eventId
          }

          setEvents(prev => {
            // Deduplicate by (org_id, id)
            const isDuplicate = prev.some(
              e => String(e.org_id) === eventOrgId && e.id === eventId
            )
            if (isDuplicate) return prev

            const next = [...prev, parsed]
            // Cap at maxItems
            if (next.length > maxItems) {
              return next.slice(next.length - maxItems)
            }
            return next
          })
        },
        // onCursor: update per-org cursors from control frame
        (cursorByOrg) => {
          lastByOrgRef.current = { ...lastByOrgRef.current, ...cursorByOrg }
        },
        // onReconnect: handle reconnect signal from server
        (reconnectData) => {
          // Server wants us to reconnect (lifetime or reauth)
          // The stream will close naturally; reconnect loop handles it
        },
        // onDeauthz: handle deauthorization for a specific org
        (deauthzData) => {
          const droppedOrg = String(deauthzData.dropped_org || '')
          if (droppedOrg) {
            // Remove the dropped org from our cursor map
            const updated = { ...lastByOrgRef.current }
            delete updated[droppedOrg]
            lastByOrgRef.current = updated
          }
        },
      )
    } catch (e) {
      if (e.name === 'AbortError') return
      throw e
    } finally {
      streamActiveRef.current = false
    }
  }, [orgId, buildQs, encodeCursorMap, parseSSEStream, maxItems])

  // Main effect: fetch recent, then open stream, with reconnect
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    abortRef.current = controller

    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        // 1. Fetch recent history
        const recentEvents = await fetchRecent()
        if (cancelled) return

        if (recentEvents && recentEvents.length > 0) {
          setEvents(recentEvents)
        }
        setLoading(false)

        // 2. Open SSE stream with reconnect loop
        while (!cancelled) {
          try {
            await openStream(controller.signal)
          } catch (e) {
            if (cancelled) break
            setError(e)
            setStale(true)

            // Exponential backoff
            const delay = Math.min(
              RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
              RECONNECT_MAX_MS,
            )
            reconnectAttemptRef.current++
            await new Promise(resolve => {
              if (cancelled) return
              const timer = setTimeout(resolve, delay)
              // Clean up timer on unmount
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timer)
                resolve()
              }, { once: true })
            })
          }
        }
      } catch (e) {
        if (cancelled) return
        setError(e)
        setLoading(false)
        setDegraded(true)
      }
    }

    run()

    return () => {
      cancelled = true
      controller.abort()
      streamActiveRef.current = false
    }
  }, [fetchRecent, openStream])

  return { events, loading, error, degraded, stale }
}
