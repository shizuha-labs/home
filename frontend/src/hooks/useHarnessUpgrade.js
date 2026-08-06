import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

/**
 * HIVE-615: fetch harness auto-upgrade status and history from the home BFF.
 *
 * GET /api/hive/harness-upgrade/status  — current status + recent history
 * GET /api/hive/harness-upgrade/history  — full upgrade history
 * POST /api/hive/harness-upgrade/trigger — manually trigger a poll cycle
 */

const STATUS_ENDPOINT = '/api/hive/harness-upgrade/status'
const HISTORY_ENDPOINT = '/api/hive/harness-upgrade/history'
const TRIGGER_ENDPOINT = '/api/hive/harness-upgrade/trigger'

/**
 * @param {{ refreshMs?: number }} [opts]
 * @returns {{
 *   status: object|null,
 *   loading: boolean,
 *   error: Error|null,
 *   refresh: () => void,
 * }}
 */
export function useHarnessUpgradeStatus({ refreshMs = 30000 } = {}) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const resp = await fetch(STATUS_ENDPOINT, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal: controller.signal,
      })
      if (handleUnauthorized(resp)) return
      if (!resp.ok) throw new Error(`harness upgrade status ${resp.status}`)
      const json = await resp.json()
      setStatus(json)
      setError(null)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    if (!refreshMs) return () => abortRef.current?.abort()
    const t = setInterval(load, refreshMs)
    return () => {
      clearInterval(t)
      abortRef.current?.abort()
    }
  }, [load, refreshMs])

  return { status, loading, error, refresh: load }
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {{
 *   upgrades: object[],
 *   loading: boolean,
 *   error: Error|null,
 *   refresh: () => void,
 * }}
 */
export function useHarnessUpgradeHistory({ limit = 20 } = {}) {
  const [upgrades, setUpgrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const resp = await fetch(`${HISTORY_ENDPOINT}?limit=${limit}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        signal: controller.signal,
      })
      if (handleUnauthorized(resp)) return
      if (!resp.ok) throw new Error(`harness upgrade history ${resp.status}`)
      const json = await resp.json()
      setUpgrades(json.upgrades || [])
      setError(null)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  return { upgrades, loading, error, refresh: load }
}

/**
 * Manually trigger a harness upgrade poll cycle.
 * @param {object} [currentVersions] - optional JSON dict of current harness versions
 * @returns {Promise<object>} trigger result
 */
export async function triggerHarnessUpgrade(currentVersions) {
  const qs = currentVersions
    ? `?current_versions=${encodeURIComponent(JSON.stringify(currentVersions))}`
    : ''
  const resp = await fetch(TRIGGER_ENDPOINT + qs, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (handleUnauthorized(resp)) throw new Error('Unauthorized')
  if (!resp.ok) throw new Error(`trigger harness upgrade ${resp.status}`)
  return resp.json()
}
