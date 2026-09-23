import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, handleUnauthorized } from '../utils/auth'
import { usePageVisible } from './usePageVisible'

const snapshots = new Map()
const MAX_SCOPES = 32
const usable = (widget) => ['ok', 'stale', 'empty'].includes(widget?.status) && widget.data != null
const stale = (payload) => payload ? ({
  ...payload,
  widgets: Object.fromEntries(Object.entries(payload.widgets || {}).map(([name, widget]) => [name,
    usable(widget) ? { ...widget, status: 'stale' } : widget,
  ])),
}) : null

// The fail-soft BFF answers HTTP 200 even when just one source failed. Merge
// only explicitly transient widget states, never a denial or authoritative empty.
function mergeWidgets(previous, next) {
  return { ...next, widgets: Object.fromEntries(Object.entries(next.widgets).map(([name, widget]) => {
    const old = previous?.widgets?.[name]
    if (['degraded', 'loading', 'stale'].includes(widget?.status) && widget.data == null && usable(old)) {
      return [name, { ...old, status: 'stale' }]
    }
    return [name, widget?.status === 'unauthorized' ? { status: 'unauthorized' } : widget]
  })) }
}

/** Scoped, bounded last-good snapshots for Home's independent widget feeds. */
export function useHomeWidgetFeed({ endpoint, orgId, refreshMs, enabled = true, widgetName = null, retain = true }) {
  const pageVisible = usePageVisible()
  const [, authChanged] = useState(0)
  const token = getAccessToken()
  const key = enabled && token ? JSON.stringify([endpoint, token, orgId == null ? null : String(orgId)]) : null
  const [state, setState] = useState(null)
  const activeKey = useRef(key)
  activeKey.current = key
  const request = useRef(null)

  useEffect(() => {
    const syncAuth = () => {
      snapshots.clear()
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
    if (request.current?.key === key) return request.current.promise
    request.current?.controller.abort()
    const controller = new AbortController()
    const current = () => activeKey.current === key && !controller.signal.aborted && getAccessToken() === token
    setState((previous) => ({ key, payload: retain ? (previous?.key === key ? previous.payload : stale(snapshots.get(key))) : null, loading: true, error: null }))
    const promise = (async () => {
      try {
        const qs = orgId != null && orgId !== '' ? `${endpoint.includes('?') ? '&' : '?'}org_id=${encodeURIComponent(orgId)}` : ''
        const response = await fetch(endpoint + qs, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        if (!current()) return
        if (response.status === 401 || response.status === 403) {
          snapshots.delete(key)
          setState({ key, payload: null, denied: true, loading: false, error: null })
          handleUnauthorized(response)
          return
        }
        if (!response.ok) throw new Error(`home widgets ${response.status}`)
        const json = await response.json()
        if (!current()) return
        if (widgetName && !json.widget?.status) throw new Error('home widget invalid response')
        const next = widgetName ? { ...json, widgets: { [widgetName]: json.widget } } : json
        if (!next.widgets || typeof next.widgets !== 'object' || Array.isArray(next.widgets)) throw new Error('home widgets invalid response')
        if (orgId != null && next.org_id != null && String(orgId) !== String(next.org_id)) throw new Error('home widgets scope mismatch')
        const payload = mergeWidgets(retain ? snapshots.get(key) : null, next)
        if (retain) {
          snapshots.delete(key)
          snapshots.set(key, payload)
          while (snapshots.size > MAX_SCOPES) snapshots.delete(snapshots.keys().next().value)
        }
        setState({ key, payload, loading: false, error: null })
      } catch (error) {
        if (!current() || error.name === 'AbortError') return
        setState({ key, payload: retain ? stale(snapshots.get(key)) : null, loading: false, error })
      } finally {
        if (request.current?.controller === controller) request.current = null
        if (current()) setState((previous) => previous?.key === key ? { ...previous, loading: false } : previous)
      }
    })()
    request.current = { key, controller, promise }
    return promise
  }, [key, endpoint, orgId, token, retain, widgetName])

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

  const visible = key && state?.key === key ? state : null
  const payload = key ? visible?.payload ?? (retain ? stale(snapshots.get(key)) : null) : null
  const fetching = visible?.loading ?? !!key
  const pending = payload?.refreshing === true
  const retryAfter = Number(payload?.retry_after_seconds)
  useEffect(() => {
    if (!pageVisible || !key || fetching || !pending || !Number.isFinite(retryAfter) || retryAfter <= 0) return undefined
    const timer = setTimeout(load, retryAfter * 1000)
    return () => clearTimeout(timer)
  }, [key, fetching, pending, retryAfter, load, pageVisible])
  const loading = !!key && (fetching || pending)
  const denied = !token || visible?.denied
  const widget = useCallback((name) => {
    if (denied) return { status: 'unauthorized' }
    return payload?.widgets?.[name] ?? { status: loading ? 'loading' : 'degraded' }
  }, [payload, loading, denied])
  return { payload, loading, error: visible?.error ?? null, widget, refresh: load }
}
