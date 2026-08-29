/**
 * First-party Live / voice telemetry.
 *
 * Browser events flush to POST /api/home/live-trace and join Connect
 * messages on GET /api/home/live-trace so a conversation has one timeline.
 * Never send tokens, passwords, or raw audio.
 */
import { getAccessToken } from './auth'

const SESSION_KEY = 'shizuha_live_trace_session'
const FLUSH_MS = 900
const FLUSH_SIZE = 16
const RING = 2500
const TEXT_CAP = 280
const ATTR_CAP = 24
const POST_CAP = 40
const NAME_RE = /^[a-z][a-z0-9_.]{1,80}$/

const SECRET_KEY = /token|password|authorization|secret|cookie|bearer/i
const SECRET_VALUE = /github_pat_|ghp_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+/i

let sessionId = ''
let callId = ''
let traceId = ''
let conversationId = ''
let userId = ''
let agent = ''
let route = ''
let queue = []
let ring = []
let flushTimer = null
let installed = false
let seq = 0

function randomId(bytes = 16) {
  const buf = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf)
  else for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const next = randomId(8)
    sessionStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return randomId(8)
  }
}

function clip(value, cap = TEXT_CAP) {
  const text = String(value ?? '')
  if (!text) return ''
  if (SECRET_VALUE.test(text)) return '[redacted]'
  return text.length > cap ? `${text.slice(0, cap)}…` : text
}

function cleanAttrs(attrs) {
  const out = {}
  if (!attrs || typeof attrs !== 'object') return out
  let n = 0
  for (const [key, value] of Object.entries(attrs)) {
    if (n >= ATTR_CAP) break
    if (!key || SECRET_KEY.test(key)) continue
    if (value == null || value === '') continue
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : String(value)
    } else if (typeof value === 'string') {
      out[key] = clip(value)
    } else if (Array.isArray(value)) {
      out[key] = clip(value.slice(0, 8).map((item) => clip(item, 80)).join(','))
    } else {
      continue
    }
    n += 1
  }
  return out
}

function nowIso() {
  return new Date().toISOString()
}

function enqueue(event) {
  queue.push(event)
  ring.push(event)
  if (ring.length > RING) ring.splice(0, ring.length - RING)
  if (queue.length >= FLUSH_SIZE) {
    void flush()
    return
  }
  if (flushTimer == null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      void flush()
    }, FLUSH_MS)
  }
}

export function getLiveTraceContext() {
  return {
    sessionId,
    callId,
    traceId,
    conversationId,
    userId,
    agent,
    route,
  }
}

export function setLiveTraceContext(next = {}) {
  if (next.conversationId != null) conversationId = String(next.conversationId || '')
  if (next.userId != null) userId = String(next.userId || '')
  if (next.agent != null) agent = String(next.agent || '')
  if (next.route != null) route = String(next.route || '')
  if (next.callId != null) callId = String(next.callId || '')
  if (next.traceId != null) traceId = String(next.traceId || '')
  return getLiveTraceContext()
}

export function beginLiveCall(extra = {}) {
  callId = randomId(8)
  traceId = randomId(16)
  if (extra.conversationId) conversationId = String(extra.conversationId)
  if (extra.agent) agent = String(extra.agent)
  emitLiveTrace('call.begin', { ...extra, call_id: callId, trace_id: traceId })
  return getLiveTraceContext()
}

export function endLiveCall(extra = {}) {
  emitLiveTrace('call.end', extra)
  return getLiveTraceContext()
}

export function voiceCorrelation() {
  return {
    call_id: callId || undefined,
    trace_id: traceId || undefined,
    conversation_id: conversationId || undefined,
    session_id: sessionId || undefined,
  }
}

export function emitLiveTrace(name, attrs = {}) {
  if (!NAME_RE.test(String(name || ''))) return null
  if (!sessionId) sessionId = readSessionId()
  seq += 1
  const event = {
    name: String(name),
    ts: nowIso(),
    seq,
    session_id: sessionId,
    call_id: callId || undefined,
    trace_id: traceId || undefined,
    conversation_id: conversationId || undefined,
    user_id: userId || undefined,
    agent: agent || undefined,
    route: route || (typeof window !== 'undefined' ? window.location.pathname : ''),
    attrs: cleanAttrs(attrs),
  }
  enqueue(event)
  return event
}

export async function flushLiveTrace() {
  return flush()
}

async function flush() {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!queue.length) return { ok: true, sent: 0 }
  const token = getAccessToken()
  if (!token) return { ok: false, sent: 0, reason: 'no_token' }
  const batch = queue.splice(0, POST_CAP)
  try {
    const res = await fetch('/api/home/live-trace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    })
    if (!res.ok && batch.length) {
      queue.unshift(...batch)
    }
    return { ok: res.ok, sent: res.ok ? batch.length : 0, status: res.status }
  } catch {
    queue.unshift(...batch)
    return { ok: false, sent: 0, reason: 'network' }
  }
}

function clickLabel(target) {
  if (!target || typeof target.closest !== 'function') return null
  const el = target.closest('button, a, [role="button"], [data-testid]')
  if (!el) return null
  const testId = el.getAttribute('data-testid') || ''
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
  const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const blob = `${testId} ${label} ${text}`.toLowerCase()
  if (!/(live|speak|mute|mic|voice|hud|call|trace|listen|end live)/i.test(blob)) return null
  return {
    testid: testId,
    label: label || text,
    tag: el.tagName.toLowerCase(),
    pressed: el.getAttribute('aria-pressed') || '',
  }
}

function emitRoute(reason) {
  const next = typeof window !== 'undefined' ? window.location.pathname : ''
  if (next === route && reason !== 'start') return
  route = next
  emitLiveTrace('nav.route', { reason, href: clip(window.location.href, 180) })
}

export function installLiveTrace() {
  if (installed || typeof window === 'undefined') return getLiveTraceContext()
  installed = true
  sessionId = readSessionId()
  route = window.location.pathname
  emitLiveTrace('session.start', {
    href: clip(window.location.href, 180),
    ua: clip(navigator.userAgent, 160),
    visible: document.visibilityState,
  })

  document.addEventListener('click', (event) => {
    const hit = clickLabel(event.target)
    if (!hit) return
    emitLiveTrace('ui.click', hit)
  }, true)

  document.addEventListener('visibilitychange', () => {
    emitLiveTrace('ui.visibility', { state: document.visibilityState })
  })

  window.addEventListener('error', (event) => {
    emitLiveTrace('page.error', {
      message: event?.message || 'error',
      source: event?.filename || '',
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    emitLiveTrace('page.rejection', {
      message: String(event?.reason?.message || event?.reason || 'rejection'),
    })
  })

  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = (...args) => {
    origPush(...args)
    emitRoute('push')
  }
  history.replaceState = (...args) => {
    origReplace(...args)
    emitRoute('replace')
  }
  window.addEventListener('popstate', () => emitRoute('pop'))

  window.addEventListener('pagehide', (event) => {
    emitLiveTrace('session.hide', { persisted: !!event?.persisted })
    void flush()
  })

  window.__shizuhaLiveTrace = () => ({
    ...getLiveTraceContext(),
    queued: queue.length,
    recent: ring.slice(-80),
  })
  return getLiveTraceContext()
}

export function recentLiveTrace(limit = 80) {
  return ring.slice(-Math.max(1, Number(limit) || 80))
}

export function resetLiveTraceForTests() {
  sessionId = ''
  callId = ''
  traceId = ''
  conversationId = ''
  userId = ''
  agent = ''
  route = ''
  queue = []
  ring = []
  seq = 0
  if (flushTimer != null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
}
