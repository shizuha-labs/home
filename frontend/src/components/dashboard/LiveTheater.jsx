import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, CheckCircle2, GitPullRequest, MessageSquare,
  Plus, Radio, RefreshCw, UserPlus, Zap,
} from 'lucide-react'
import { cn } from '../../utils/cn'

/**
 * HIVE-602 live theater — the autonomous organization as a live game HUD.
 *
 * Bands, all moving (operator directive 2026-07-10: this page's screen
 * recording is the product's primary selling asset — nothing static):
 *   0. Headline ticker — the latest event, cycling.
 *   1. Agents marquee — every working agent scrolls by, each showing WHAT
 *      it's doing right now (joined live from the feed); a fresh event
 *      flashes its chip.
 *   2. LIVE feed — comments / transitions / assignments sliding in.
 *   3. Projects moving — animated relative-activity bars.
 */

const EVENT_ICONS = {
  comment: MessageSquare,
  status_changed: ArrowRight,
  assigned: UserPlus,
  created: Plus,
  completed: CheckCircle2,
  reopened: RefreshCw,
  pr_status_changed: GitPullRequest,
}

function actorName(email) {
  const handle = String(email || '').split('@')[0]
  if (!handle) return 'Someone'
  if (handle === 'system' || handle === 'system.pulse') return 'Pulse'
  return handle.charAt(0).toUpperCase() + handle.slice(1)
}

function timeAgo(iso, now) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function eventKey(ev) {
  return `${ev.at}|${ev.type}|${ev.item_key}|${ev.actor_email || ''}`
}

function humanStatus(slug) {
  return String(slug || '').replace(/[_-]+/g, ' ')
}

function verbFor(ev) {
  switch (ev?.type) {
    case 'comment': return 'discussing'
    case 'status_changed': return `moving to ${humanStatus(ev.new)}`
    case 'assigned': return 'picking up'
    case 'created': return 'filing'
    case 'completed': return 'shipping'
    case 'reopened': return 'reopening'
    case 'pr_status_changed': return 'landing PR on'
    default: return 'working'
  }
}

function eventPhrase(ev) {
  switch (ev.type) {
    case 'comment':
      return ev.excerpt || 'commented'
    case 'status_changed':
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-gray-400 dark:text-gray-500">{humanStatus(ev.old)}</span>
          <ArrowRight className="h-3 w-3 text-brand-500" />
          <span className="font-medium text-gray-700 dark:text-gray-200">{humanStatus(ev.new)}</span>
        </span>
      )
    case 'assigned':
      return `took ownership${ev.new ? ` (${humanStatus(ev.new)})` : ''}`
    case 'created':
      return 'filed this'
    case 'completed':
      return 'shipped it'
    case 'reopened':
      return 'reopened it'
    case 'pr_status_changed':
      return `PR ${humanStatus(ev.new) || 'updated'}`
    default:
      return humanStatus(ev.type)
  }
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 ring-1 ring-red-500/30">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
      </span>
      <span className="text-[10px] font-bold tracking-widest text-red-500">LIVE</span>
    </span>
  )
}

function Ticker({ events, now }) {
  const [idx, setIdx] = useState(0)
  const pool = events.slice(0, 8)
  useEffect(() => {
    if (pool.length < 2) return undefined
    const id = setInterval(() => setIdx((i) => (i + 1) % pool.length), 5000)
    return () => clearInterval(id)
  }, [pool.length])
  const ev = pool[idx % Math.max(pool.length, 1)]
  if (!ev) return null
  return (
    <div className="mb-3 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <LiveBadge />
      <span key={eventKey(ev)} className="animate-feed-in truncate">
        <span className="font-semibold text-gray-700 dark:text-gray-200">{actorName(ev.actor_email)}</span>{' '}
        {verbFor(ev)}{' '}
        <span className="font-mono text-brand-600 dark:text-brand-400">{ev.item_key}</span>
        <span className="text-gray-400 dark:text-gray-500"> · {timeAgo(ev.at, now)}</span>
      </span>
    </div>
  )
}

function AgentCard({ agent, doing, flash }) {
  const initials = (agent.name || agent.username || '?').slice(0, 2)
  return (
    <div
      title={`${agent.role || 'Agent'} · ${agent.model || ''}`}
      className={cn(
        'flex w-44 shrink-0 items-center gap-2.5 rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-gray-200/70 backdrop-blur-sm dark:bg-gray-900/70 dark:ring-gray-700/50',
        flash && 'animate-flash-ring ring-emerald-400/70',
      )}
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500/90 to-purple-500/90 text-[11px] font-bold uppercase text-white shadow-sm">
        {initials}
        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-gray-900" />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
          {agent.name}
          <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">{(agent.teams || [])[0]}</span>
        </span>
        <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
          {doing ? (
            <>
              {verbFor(doing)}{' '}
              <span className="font-mono text-brand-600 dark:text-brand-400">{doing.item_key}</span>
            </>
          ) : (
            <span className="italic">on the clock</span>
          )}
        </span>
      </span>
    </div>
  )
}

function FeedRow({ ev, isNew, now }) {
  const Icon = EVENT_ICONS[ev.type] || Zap
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border-l-2 px-3 py-2 transition-colors hover:bg-white/70 dark:hover:bg-gray-800/50',
        ev.type === 'completed'
          ? 'border-emerald-400/70'
          : ev.type === 'comment'
            ? 'border-brand-400/60'
            : 'border-transparent',
        isNew && 'animate-feed-in',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          ev.type === 'comment'
            ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/50 dark:text-brand-300'
            : ev.type === 'completed'
              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-gray-700 dark:text-gray-200">
          <span className="font-semibold">{actorName(ev.actor_email)}</span>{' '}
          <span className="text-gray-500 dark:text-gray-400">on</span>{' '}
          <span className="font-mono text-[11px] text-brand-600 dark:text-brand-400">{ev.item_key}</span>
          {ev.item_title ? (
            <span className="text-gray-400 dark:text-gray-500"> · {ev.item_title}</span>
          ) : null}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{eventPhrase(ev)}</p>
      </div>
      <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
        {timeAgo(ev.at, now)}
      </span>
    </div>
  )
}

export default function LiveTheater({ feed, agents }) {
  const [now, setNow] = useState(() => Date.now())
  const seenRef = useRef(new Set())
  const [newKeys, setNewKeys] = useState(() => new Set())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const events = useMemo(
    () => (feed?.status === 'ok' || feed?.status === 'stale' ? feed.data || [] : []),
    [feed],
  )
  const agentRows = useMemo(
    () => (agents?.status === 'ok' || agents?.status === 'stale' ? agents.data || [] : []),
    [agents],
  )

  useEffect(() => {
    if (!events.length) return
    const seen = seenRef.current
    const first = seen.size === 0
    const fresh = new Set()
    for (const ev of events) {
      const k = eventKey(ev)
      if (!seen.has(k)) {
        seen.add(k)
        if (!first) fresh.add(k)
      }
    }
    if (fresh.size) {
      setNewKeys(fresh)
      setNow(Date.now())
    }
  }, [events])

  const working = agentRows.filter((a) => a.status === 'running')
  const hourAgo = now - 3600_000
  const eventsLastHour = events.filter((e) => new Date(e.at).getTime() >= hourAgo).length

  // Join each working agent to its latest event → the "doing" line.
  const doingByEmail = useMemo(() => {
    const m = new Map()
    for (const ev of events) {
      const e = String(ev.actor_email || '').toLowerCase()
      if (e && !m.has(e)) m.set(e, ev)
    }
    return m
  }, [events])
  const freshActors = useMemo(() => {
    const s = new Set()
    for (const ev of events) {
      if (newKeys.has(eventKey(ev))) s.add(String(ev.actor_email || '').toLowerCase())
    }
    return s
  }, [events, newKeys])

  const projects = useMemo(() => {
    const counts = new Map()
    for (const ev of events) {
      if (!ev.project) continue
      counts.set(ev.project, (counts.get(ev.project) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [events])
  const maxProject = projects.length ? projects[0][1] : 1

  if (!events.length && !working.length) return null

  // Sort working agents: those with a live "doing" first.
  const marqueeAgents = [...working].sort((a, b) => {
    const da = doingByEmail.has(String(a.email).toLowerCase()) ? 0 : 1
    const db = doingByEmail.has(String(b.email).toLowerCase()) ? 0 : 1
    return da - db || String(a.name).localeCompare(String(b.name))
  })

  return (
    <div className="mt-6 text-left">
      <Ticker events={events} now={now} />

      {/* Band 1 — agents marquee: the fleet scrolls by, each showing what
          it's doing right now. Pauses on hover. */}
      {marqueeAgents.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {marqueeAgents.length} agents working now
            </span>
            {eventsLastHour > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                · {eventsLastHour} updates in the last hour
              </span>
            )}
          </div>
          <div className="group relative overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white/80 to-transparent dark:from-gray-950/80" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white/80 to-transparent dark:from-gray-950/80" />
            <div className="flex w-max animate-marquee gap-2 group-hover:[animation-play-state:paused]">
              {[...marqueeAgents, ...marqueeAgents].map((a, i) => {
                const email = String(a.email).toLowerCase()
                return (
                  <AgentCard
                    key={`${email}-${i}`}
                    agent={a}
                    doing={doingByEmail.get(email)}
                    flash={freshActors.has(email)}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_190px]">
        {/* Band 2 — the live feed */}
        <div className="rounded-2xl bg-white/60 p-2 ring-1 ring-gray-200/60 backdrop-blur-sm dark:bg-gray-900/50 dark:ring-gray-700/40">
          {events.length > 0 ? (
            <div className="max-h-80 space-y-0.5 overflow-y-auto">
              {events.slice(0, 30).map((ev) => (
                <FeedRow key={eventKey(ev)} ev={ev} isNew={newKeys.has(eventKey(ev))} now={now} />
              ))}
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400" />
              Tuning in — the first events land in seconds…
            </div>
          )}
        </div>

        {/* Band 3 — projects moving, with relative-activity bars */}
        {projects.length > 0 && (
          <div className="hidden flex-col gap-2 lg:flex">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Projects moving
            </span>
            {projects.map(([proj, count]) => (
              <div
                key={proj}
                className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-gray-200/60 backdrop-blur-sm dark:bg-gray-900/50 dark:ring-gray-700/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{proj}</span>
                  <span
                    key={`${proj}-${count}`}
                    className="animate-feed-in text-[10px] font-bold tabular-nums text-brand-600 dark:text-brand-400"
                  >
                    {count}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    key={`${proj}-bar-${count}`}
                    className="h-full origin-left animate-bar-grow rounded-full bg-gradient-to-r from-brand-500 to-purple-500"
                    style={{ width: `${Math.max(12, Math.round((count / maxProject) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
