import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import { getAccessToken } from '../utils/auth'
import { installLiveTrace } from '../utils/liveTrace'

function formatTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function attrLine(attrs) {
  if (!attrs || typeof attrs !== 'object') return ''
  return Object.entries(attrs)
    .filter(([, value]) => value !== '' && value != null)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ')
}

export default function LiveTracePage() {
  const { isAuthenticated, isLoading, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [live, setLive] = useState(true)
  const conversationId = params.get('conversation') || ''
  const callId = params.get('call') || ''

  useEffect(() => {
    installLiveTrace()
  }, [])

  const load = useCallback(async () => {
    const token = getAccessToken()
    if (!token) return
    const qs = new URLSearchParams()
    if (conversationId) qs.set('conversation_id', conversationId)
    if (callId) qs.set('call_id', callId)
    qs.set('include_messages', '1')
    qs.set('limit', '400')
    try {
      const res = await fetch(`/api/home/live-trace?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setError(`trace ${res.status}`)
        return
      }
      setError('')
      setData(await res.json())
    } catch (err) {
      setError(String(err?.message || err))
    }
  }, [callId, conversationId])

  useEffect(() => {
    if (!isAuthenticated) return
    void load()
    if (!live) return undefined
    const timer = window.setInterval(() => { void load() }, 2500)
    return () => window.clearInterval(timer)
  }, [isAuthenticated, live, load])

  const events = useMemo(() => data?.events || [], [data])
  const calls = useMemo(() => {
    const seen = new Map()
    for (const event of events) {
      if (event.call_id && !seen.has(event.call_id)) seen.set(event.call_id, event.ts)
    }
    return [...seen.entries()]
  }, [events])

  if (isLoading) {
    return <div className="min-h-screen bg-white dark:bg-gray-950" />
  }
  if (!isAuthenticated) {
    window.location.href = `/id/login?continue=${encodeURIComponent('/live-trace')}`
    return null
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <GlobalNavBar />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-400">Live trace</p>
            <h1 className="text-xl font-semibold tracking-tight">Voice + chat timeline</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Browser actions joined with Connect messages for {user?.username || user?.email || 'you'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ${
                live
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-500 ring-gray-200 dark:bg-gray-800'
              }`}
            >
              {live ? 'Live' : 'Paused'}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              Refresh
            </button>
            <Link to="/" className="rounded-lg px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800">Home</Link>
          </div>
        </div>

        <form
          className="mt-5 grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            const next = new URLSearchParams()
            const conv = event.currentTarget.conversation.value.trim()
            const call = event.currentTarget.call.value.trim()
            if (conv) next.set('conversation', conv)
            if (call) next.set('call', call)
            setParams(next)
          }}
        >
          <input
            name="conversation"
            defaultValue={conversationId}
            placeholder="Conversation id"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
          />
          <input
            name="call"
            defaultValue={callId}
            placeholder="Call id"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
          />
          <button type="submit" className="sr-only">Filter</button>
        </form>

        {calls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {calls.map(([id, ts]) => (
              <button
                key={id}
                type="button"
                onClick={() => setParams({ ...(conversationId ? { conversation: conversationId } : {}), call: id })}
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] ring-1 ${
                  callId === id
                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                    : 'bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-900 dark:text-gray-300'
                }`}
              >
                {id.slice(0, 8)} · {formatTs(ts)}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-4 text-sm text-amber-700">{error}</p>}
        <p className="mt-4 text-xs text-gray-400">{events.length} events</p>

        <ol className="mt-3 space-y-1">
          {events.map((event, index) => (
            <li
              key={event.id || `${event.ts}-${event.name}-${index}`}
              className="grid grid-cols-[5.5rem_9rem_1fr] gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              <span className="font-mono text-[11px] text-gray-400">{formatTs(event.ts)}</span>
              <span className={`truncate font-medium ${
                event.source === 'connect' ? 'text-violet-600 dark:text-violet-300' : 'text-gray-800 dark:text-gray-100'
              }`}
              >
                {event.name}
              </span>
              <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{attrLine(event.attrs)}</span>
            </li>
          ))}
        </ol>
        {events.length === 0 && !error && (
          <p className="mt-8 text-sm text-gray-500">No traces yet. Start a Live call or send a chat turn, then refresh.</p>
        )}
      </main>
    </div>
  )
}
