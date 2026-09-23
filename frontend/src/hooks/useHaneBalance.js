import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'
import { usePageVisible } from './usePageVisible'

// Match the Home summary's visible refresh cadence. Only the first read keeps
// the existing login initialization; recurring reads never award credits.
export function useHaneBalance({ refreshMs = 30000 } = {}) {
  const visible = usePageVisible()
  const [, authChanged] = useState(0)
  const token = getAccessToken()
  const activeToken = useRef(token)
  activeToken.current = token
  const initialized = useRef(null)
  const request = useRef(null)
  const [state, setState] = useState(null)

  useEffect(() => {
    const changed = () => {
      request.current?.controller.abort()
      request.current = null
      setState(null)
      authChanged((revision) => revision + 1)
    }
    const storage = (event) => { if (event.key === null || event.key === 'shizuha_access_token') changed() }
    window.addEventListener('shizuha-auth-cleared', changed)
    window.addEventListener('shizuha-auth-refreshed', changed)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener('shizuha-auth-cleared', changed)
      window.removeEventListener('shizuha-auth-refreshed', changed)
      window.removeEventListener('storage', storage)
    }
  }, [])

  const refresh = useCallback(() => {
    if (!token || document.visibilityState === 'hidden') return Promise.resolve()
    if (request.current?.token === token) return request.current.promise
    request.current?.controller.abort()
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && activeToken.current === token && getAccessToken() === token
    const endpoint = initialized.current === token ? '/v1/hane?view=balance' : '/v1/hane'
    initialized.current = token
    setState((old) => ({ ...(old?.token === token ? old : {}), token, loading: true }))
    const promise = (async () => {
      try {
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        if (!current()) return
        if (response.status === 401 || response.status === 403) {
          setState({ token, denied: true })
          handleUnauthorized(response)
          return
        }
        if (response.status === 404) {
          // The projection explicitly reports a missing purse. It is not a
          // transient failure and cannot justify showing an older balance.
          setState({ token, stale: true, error: new Error('Hane purse unavailable') })
          return
        }
        if (!response.ok) throw new Error(`Hane balance ${response.status}`)
        const data = await response.json()
        if (!current()) return
        if (!Number.isFinite(data?.available) || data.available < 0) throw new Error('Invalid Hane balance')
        // The original login payload has no observation time. Record receipt
        // time explicitly; failures must never advance this last-good clock.
        const observedAt = data.observed_at || new Date().toISOString()
        if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid Hane observation time')
        setState({ token, data: { available: data.available, fiat: typeof data.fiat?.label === 'string' ? data.fiat.label : null }, observedAt })
      } catch (error) {
        if (!current() || error.name === 'AbortError') return
        setState((old) => ({ ...(old?.token === token ? old : {}), token, error, stale: true }))
      } finally {
        if (request.current?.controller === controller) request.current = null
        if (current()) setState((old) => old?.token === token ? { ...old, loading: false } : old)
      }
    })()
    request.current = { token, controller, promise }
    return promise
  }, [token])

  useEffect(() => () => {
    if (request.current?.token === token) {
      request.current.controller.abort()
      request.current = null
    }
  }, [token])

  useEffect(() => {
    if (!visible) return undefined
    refresh()
    const timer = token && refreshMs ? setInterval(refresh, refreshMs) : null
    window.addEventListener('focus', refresh)
    return () => {
      if (timer) clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [visible, token, refreshMs, refresh])

  return { ...(token && state?.token === token ? state : {}), refresh }
}
