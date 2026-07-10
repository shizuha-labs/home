import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bot, Building2, ListTodo, X,
} from 'lucide-react'
import { cn } from '../../utils/cn'
import { getAccessToken, handleUnauthorized } from '../../utils/auth'

/**
 * HIVE-602 cockpit peeks — drill into orgs, teams, agents, and tasks WITHOUT
 * leaving shizuha.com. A right-side drawer, driven by a small navigation
 * stack so agent → task → back flows feel native. Data comes from the BFF
 * drill-down endpoints (/api/home/agent, /api/home/org-map, /api/home/task),
 * fetched on open, fail-soft.
 */

export function AgentAvatar({ username, name, size = 'md', className }) {
  const [broken, setBroken] = useState(false)
  const initials = (name || username || '?').slice(0, 2)
  const sizes = {
    sm: 'h-6 w-6 text-[9px] rounded-md',
    md: 'h-8 w-8 text-[11px] rounded-lg',
    lg: 'h-14 w-14 text-lg rounded-xl',
  }
  if (!username || broken) {
    return (
      <span className={cn(
        'flex items-center justify-center bg-gradient-to-br from-brand-500/90 to-purple-500/90 font-bold uppercase text-white shadow-sm',
        sizes[size], className,
      )}>
        {initials}
      </span>
    )
  }
  return (
    <img
      src={`/avatars/${String(username).toLowerCase()}.png`}
      alt={name || username}
      onError={() => setBroken(true)}
      className={cn('object-cover shadow-sm', sizes[size], className)}
    />
  )
}

function usePeekData(peek) {
  const [state, setState] = useState({ loading: true, widget: null })
  useEffect(() => {
    if (!peek) return undefined
    let cancelled = false
    setState({ loading: true, widget: null })
    const url =
      peek.type === 'agent' ? `/api/home/agent?email=${encodeURIComponent(peek.email)}`
        : peek.type === 'org' ? `/api/home/org-map?org_id=${encodeURIComponent(peek.orgId)}`
          : `/api/home/task?key=${encodeURIComponent(peek.itemKey)}`
    ;(async () => {
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        })
        if (handleUnauthorized(resp)) return
        const body = resp.ok ? await resp.json() : null
        if (!cancelled) setState({ loading: false, widget: body?.widget || { status: 'degraded' } })
      } catch {
        if (!cancelled) setState({ loading: false, widget: { status: 'degraded' } })
      }
    })()
    return () => { cancelled = true }
  }, [peek])
  return state
}

function timeAgo(iso) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function human(slug) {
  return String(slug || '').replace(/[_-]+/g, ' ')
}

function StatusChip({ status, category }) {
  const cat = category || ''
  return (
    <span className={cn(
      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      cat === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : cat === 'in_progress' ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {human(status)}
    </span>
  )
}

function Line({ children }) {
  return <p className="text-xs text-gray-600 dark:text-gray-300">{children}</p>
}

function SectionTitle({ children }) {
  return (
    <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
      {children}
    </p>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-2 animate-pulse pt-4">
      {[90, 75, 60].map((w) => (
        <div key={w} className="h-3 rounded bg-gray-200/70 dark:bg-gray-700/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

function AgentPeekBody({ peek, widget, localEvents, loading, onOpenTask }) {
  const data = widget?.data || {}
  const tasks = data.tasks || []
  // GAME PRINCIPLE (operator 2026-07-10): never wait to show what a player is
  // doing. The cockpit already holds the live feed — render THAT instantly;
  // the network fetch only deepens history/tasks in the background.
  const events = (data.events && data.events.length ? data.events : localEvents) || []
  return (
    <>
      <div className="flex items-center gap-3">
        <AgentAvatar username={peek.username} name={peek.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{peek.name || peek.username}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{peek.role}</p>
          <p className="truncate text-[10px] text-gray-400 dark:text-gray-500">
            {(peek.teams || []).join(' · ')}{peek.model ? ` · ${peek.model}` : ''}
          </p>
        </div>
        {peek.status === 'running' && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
          </span>
        )}
      </div>

      {loading && tasks.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> syncing their desk…
        </p>
      )}
      {tasks.length > 0 && (
        <>
          <SectionTitle>On their desk</SectionTitle>
          <div className="space-y-1">
            {tasks.map((t) => (
              <button
                key={t.key}
                onClick={() => onOpenTask(t.key)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-100/70 dark:hover:bg-gray-800/60"
              >
                <span className="font-mono text-[11px] text-brand-600 dark:text-brand-400">{t.key}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-200">{t.title}</span>
                <StatusChip status={t.status} category={t.status_category} />
              </button>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Recent activity</SectionTitle>
      {events.length === 0 ? (
        <Line>Quiet right now.</Line>
      ) : (
        <ol className="space-y-2">
          {events.slice(0, 15).map((ev, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <div className="min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-300">
                <button
                  onClick={() => onOpenTask(ev.item_key)}
                  className="font-mono text-[11px] text-brand-600 hover:underline dark:text-brand-400"
                >
                  {ev.item_key}
                </button>{' '}
                {ev.type === 'comment'
                  ? <span className="line-clamp-2">{(ev.excerpt || 'commented').replace(/[*_`#>]+/g, '')}</span>
                  : <span>{human(ev.type)}{ev.new ? ` → ${human(ev.new)}` : ''}</span>}
                <span className="ml-1 text-[10px] text-gray-400">{timeAgo(ev.at)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function OrgPeekBody({ peek, widget, agents, onOpenAgent }) {
  const teams = widget?.data?.teams || []
  const byEmail = new Map((agents || []).map((a) => [String(a.email).toLowerCase(), a]))
  const staffed = teams.filter((t) => (t.members || []).length > 0)
  const rest = teams.filter((t) => (t.members || []).length === 0)
  const active = (w) => (w?.open || 0) + (w?.in_progress || 0) + (w?.in_review || 0)
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-lg font-bold text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
          {(peek.name || '?').slice(0, 1)}
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{peek.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{teams.length} teams</p>
        </div>
      </div>
      <SectionTitle>Teams</SectionTitle>
      {widget?.status === 'unauthorized' ? (
        <Line>Team map is not shared with you.</Line>
      ) : teams.length === 0 ? (
        <Line>No team data yet.</Line>
      ) : (
        <div className="space-y-2">
          {[...staffed, ...rest].map((t) => (
            <div key={t.id || t.name} className="rounded-xl bg-gray-50/80 px-3 py-2 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{t.name}</span>
                <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                  {active(t.workload)} active · {t.workload?.blocked || 0} blocked · {t.workload?.completed || 0} done
                </span>
              </div>
              {(t.members || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.members.map((email) => {
                    const a = byEmail.get(String(email).toLowerCase())
                    const uname = a?.username || String(email).split('@')[0]
                    return (
                      <button
                        key={email}
                        title={a?.name || email}
                        onClick={() => onOpenAgent(a || { email, username: uname, name: uname })}
                        className="transition-transform hover:scale-110"
                      >
                        <AgentAvatar username={uname} name={a?.name || uname} size="sm" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function TaskPeekBody({ widget, agents, onOpenAgent }) {
  const data = widget?.data || {}
  const item = data.item || {}
  const byEmail = new Map((agents || []).map((a) => [String(a.email).toLowerCase(), a]))
  const assignee = item.assignee ? byEmail.get(String(item.assignee).toLowerCase()) : null
  const auname = assignee?.username || String(item.assignee || '').split('@')[0]
  return (
    <>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">{item.key}</span>
        <StatusChip status={item.status} category={item.status_category} />
      </div>
      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{item.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        {item.assignee ? (
          <button onClick={() => onOpenAgent(assignee || { email: item.assignee, username: auname, name: auname })}
                  className="flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400">
            <AgentAvatar username={auname} name={auname} size="sm" />
            <span>{assignee?.name || auname}</span>
          </button>
        ) : <span>unassigned</span>}
        {item.team ? <span>· {item.team}</span> : null}
        {item.updated_at ? <span>· updated {timeAgo(item.updated_at)}</span> : null}
      </div>

      {(data.activity || []).length > 0 && (
        <>
          <SectionTitle>Activity</SectionTitle>
          <ol className="space-y-1.5">
            {data.activity.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-gray-300 dark:text-gray-600" />
                <span className="min-w-0">
                  <span className="font-medium">{String(a.actor || '').split('@')[0]}</span>{' '}
                  {human(a.action)}{a.new ? ` → ${human(a.new)}` : ''}
                  <span className="ml-1 text-[10px] text-gray-400">{timeAgo(a.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {(data.comments || []).length > 0 && (
        <>
          <SectionTitle>Discussion</SectionTitle>
          <ol className="space-y-2">
            {data.comments.map((c, i) => (
              <li key={i} className="rounded-lg bg-gray-50/80 px-2.5 py-1.5 dark:bg-gray-800/50">
                <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                  {String(c.author || '').split('@')[0]} <span className="font-normal text-gray-400">{timeAgo(c.at)}</span>
                </p>
                <p className="line-clamp-3 text-xs text-gray-700 dark:text-gray-200">
                  {(c.excerpt || '').replace(/[*_`#>]+/g, '')}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}

const PEEK_ICONS = { agent: Bot, org: Building2, task: ListTodo }

export default function CockpitPeek({ stack, onPush, onPop, onClose, agents, feed }) {
  const peek = stack[stack.length - 1]
  const { loading, widget } = usePeekData(peek)
  const openTask = useCallback((key) => key && onPush({ type: 'task', itemKey: key }), [onPush])
  const openAgent = useCallback((a) => a?.email && onPush({
    type: 'agent', email: String(a.email).toLowerCase(),
    username: a.username, name: a.name, role: a.role, teams: a.teams,
    model: a.model, status: a.status,
  }), [onPush])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!peek) return null
  const feedEvents = Array.isArray(feed) ? feed : []
  const localEvents = peek.type === 'agent'
    ? feedEvents.filter((ev) => String(ev.actor_email || '').toLowerCase() === peek.email)
    : []
  const Icon = PEEK_ICONS[peek.type] || Bot
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          {stack.length > 1 ? (
            <button onClick={onPop} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Icon className="h-4 w-4 text-gray-400" />
          )}
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {peek.type === 'agent' ? 'Agent' : peek.type === 'org' ? 'Organization' : 'Task'}
          </span>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {peek.type === 'agent' ? (
            /* Instant render from client-held state; network deepens it. */
            <AgentPeekBody peek={peek} widget={widget} localEvents={localEvents}
                           loading={loading} onOpenTask={openTask} />
          ) : peek.type === 'task' && loading && peek.itemTitle ? (
            /* Task peek: show what we already know from the clicked row. */
            <>
              <p className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">{peek.itemKey}</p>
              <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{peek.itemTitle}</p>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> syncing activity…
              </p>
            </>
          ) : loading ? <LoadingRows /> : (
            peek.type === 'org'
              ? <OrgPeekBody peek={peek} widget={widget} agents={agents} onOpenAgent={openAgent} />
              : <TaskPeekBody widget={widget} agents={agents} onOpenAgent={openAgent} />
          )}
          {!loading && widget?.status === 'degraded' && peek.type !== 'agent' && (
            <p className="mt-4 text-xs text-amber-500">Some details are temporarily unavailable.</p>
          )}
          {!loading && widget?.status === 'degraded' && peek.type === 'agent' && localEvents.length === 0 && (
            <p className="mt-4 text-xs text-amber-500">Live history is temporarily unavailable.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
