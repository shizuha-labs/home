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
 *   - All close paths (clean EOF, reconnect signal, 401) apply exponential
 *     backoff and acquire a fresh token before reconnecting (HIVE-607 P2)
 *   - 503 falls back to polling /recent (HLD §6.2)
 */

const RECENT_ENDPOINT = '/api/home/activity/recent'
const STREAM_ENDPOINT = '/api/home/activity/stream'
const MAX_ITEMS = 100
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const POLL_INTERVAL_MS = 15000

/**
 * Typed error for stream close paths that should trigger a backoff reconnect
 * (clean EOF, reconnect signal, handled 401) rather than an immediate retry.
 */
class StreamClosedError extends Error {
  constructor(reason) {
    super(`Stream closed: ${reason}`)
    this.name = 'StreamClosedError'
    this.reason = reason
  }
}

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
        // Single-org: send bare since=<redis_id> (HLD §6)
        params.set('since', since)
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
              } catch (e) {
                // Re-throw StreamClosedError from onReconnect callback
                if (e instanceof StreamClosedError) throw e
                /* skip malformed */
              }
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
      let since
      let sinceByOrg
      if (orgId) {
        // Single-org: use bare since=<redis_id> (HLD §6)
        since = lastByOrgRef.current[orgId] || undefined
      } else {
        // Aggregate: use since_by_org base64url-json
        if (Object.keys(lastByOrgRef.current).length > 0) {
          sinceByOrg = encodeCursorMap(lastByOrgRef.current)
        }
      }

      // Acquire a fresh token for each reconnect attempt (HLD §7)
      const token = getAccessToken()
      if (!token) {
        streamActiveRef.current = false
        throw new StreamClosedError('no_token')
      }

      const qs = buildQs({ since, sinceByOrg })
      const resp = await fetch(STREAM_ENDPOINT + qs, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      if (handleUnauthorized(resp)) {
        streamActiveRef.current = false
        // 401 is a handled close path — apply backoff, don't retry immediately
        throw new StreamClosedError('unauthorized')
      }
      if (resp.status === 503) {
        streamActiveRef.current = false
        // 503: fall back to polling /recent (HLD §6.2)
        throw new StreamClosedError('service_unavailable')
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
          // Server wants us to reconnect (lifetime or reauth).
          // The stream will close naturally; throw so the outer loop
          // applies backoff and acquires a fresh token.
          throw new StreamClosedError(reconnectData.reason || 'server_reconnect')
        },
        // onDeauthz: handle deauthorization for a specific org
        (deauthzData) => {
          const droppedOrg = String(deauthzData.dropped_org || '')
          if (droppedOrg) {
            // Remove the dropped org from our cursor map
            const updated = { ...lastByOrgRef.current }
            delete updated[droppedOrg]
            lastByOrgRef.current = updated
            // Remove already-rendered events for the dropped org (HLD §6)
            setEvents(prev => prev.filter(e => String(e.org_id) !== droppedOrg))
          }
        },
      )

      // parseSSEStream returned normally = clean EOF.
      // Apply backoff rather than reconnecting immediately.
      throw new StreamClosedError('clean_eof')
    } catch (e) {
      if (e.name === 'AbortError') return
      // Re-throw StreamClosedError so the outer loop applies backoff
      if (e instanceof StreamClosedError) throw e
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
          // Cap recent events at maxItems
          const capped = recentEvents.length > maxItems
            ? recentEvents.slice(recentEvents.length - maxItems)
            : recentEvents
          setEvents(capped)
        }
        setLoading(false)

        // 2. Open SSE stream with reconnect loop
        while (!cancelled) {
          try {
            await openStream(controller.signal)
          } catch (e) {
            if (cancelled) break

            if (e instanceof StreamClosedError && e.reason === 'service_unavailable') {
              // 503: fall back to polling /recent (HLD §6.2)
              setStale(true)
              setDegraded(true)
              while (!cancelled) {
                await new Promise(resolve => {
                  const timer = setTimeout(resolve, POLL_INTERVAL_MS)
                  controller.signal.addEventListener('abort', () => {
                    clearTimeout(timer)
                    resolve()
                  }, { once: true })
                })
                if (cancelled) break
                try {
                  const pollEvents = await fetchRecent()
                  if (cancelled) break
                  if (pollEvents && pollEvents.length > 0) {
                    setEvents(pollEvents)
                  }
                  // Try to re-establish stream on next poll cycle
                  break
                } catch {
                  // Poll failed, keep polling
                }
              }
              continue
            }

            setError(e)
            setStale(true)

            // Exponential backoff for all close paths (clean EOF, 401,
            // reconnect signal, network errors)
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
