import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, CheckCircle2, GitPullRequest, MessageSquare,
  Plus, RefreshCw, UserPlus, Zap,
} from 'lucide-react'
import { cn } from '../../utils/cn'

/**
 * HIVE-602 live theater — the autonomous organization, visibly working.
 *
 * Three moving bands fed by /api/home/activity (8s poll):
 *   1. Agents at work — every running agent as a live entity.
 *   2. Live feed — comments / transitions / assignments as they land,
 *      new events slide in.
 *   3. Projects moving — which projects the events are landing in.
 *
 * Everything here must MOVE: this page's screen recording is the product's
 * primary selling asset (operator directive 2026-07-10).
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

function AgentChip({ agent }) {
  const initials = (agent.name || agent.username || '?').slice(0, 2)
  const working = agent.status === 'running'
  return (
    <div
      title={`${agent.role || 'Agent'} · ${agent.model || ''}`}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 ring-1 backdrop-blur-sm transition-all',
        working
          ? 'bg-white/80 ring-emerald-300/60 dark:bg-gray-900/70 dark:ring-emerald-700/50'
          : 'bg-white/40 ring-gray-200/50 opacity-60 dark:bg-gray-900/40 dark:ring-gray-700/40',
      )}
    >
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold uppercase text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
        {initials}
        {working && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
      </span>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{agent.name}</span>
      <span className="hidden text-[10px] text-gray-400 dark:text-gray-500 sm:inline">
        {(agent.teams || [])[0] || agent.role}
      </span>
    </div>
  )
}

function FeedRow({ ev, isNew, now }) {
  const Icon = EVENT_ICONS[ev.type] || Zap
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/70 dark:hover:bg-gray-800/50',
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

  // Tick relative timestamps.
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

  // Mark unseen events so they animate in exactly once.
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

  const projects = useMemo(() => {
    const counts = new Map()
    for (const ev of events) {
      if (!ev.project) continue
      counts.set(ev.project, (counts.get(ev.project) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [events])

  if (!events.length && !working.length) return null

  return (
    <div className="mt-8 text-left">
      {/* Band 1 — agents at work */}
      {working.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {working.length} agents working now
            </span>
            {eventsLastHour > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                · {eventsLastHour} updates in the last hour
              </span>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {working.map((a) => (
              <AgentChip key={a.email || a.username} agent={a} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_180px]">
        {/* Band 2 — the live feed */}
        <div className="rounded-2xl bg-white/60 p-2 ring-1 ring-gray-200/60 backdrop-blur-sm dark:bg-gray-900/50 dark:ring-gray-700/40">
          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {events.slice(0, 30).map((ev) => (
              <FeedRow key={eventKey(ev)} ev={ev} isNew={newKeys.has(eventKey(ev))} now={now} />
            ))}
          </div>
        </div>

        {/* Band 3 — projects moving */}
        {projects.length > 0 && (
          <div className="hidden flex-col gap-2 lg:flex">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Projects moving
            </span>
            {projects.map(([proj, count]) => (
              <div
                key={proj}
                className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2 ring-1 ring-gray-200/60 backdrop-blur-sm dark:bg-gray-900/50 dark:ring-gray-700/40"
              >
                <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{proj}</span>
                <span
                  key={`${proj}-${count}`}
                  className="animate-feed-in rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold tabular-nums text-brand-700 dark:bg-brand-900/60 dark:text-brand-300"
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
