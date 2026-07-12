import { useMemo } from 'react'
import { Activity, AlertTriangle, CheckCircle2, TrendingUp, Timer, RefreshCw } from 'lucide-react'
import { useOrgProgress } from '../../hooks/useOrgProgress'

/**
 * Org-progress dashboard: is the org making progress, and is anything badly
 * wrong? Renders, org-scoped and live (BFF `/api/home/progress`), hand-rolled
 * SVG charts (no chart lib — keeps the React-dedupe-safe bundle small):
 *   - a health banner (green / amber / red at a glance),
 *   - headline KPIs (resolved vs created in-window, in-flight, blocked, overdue),
 *   - a resolution-rate trend (completed vs created per bucket),
 *   - a status distribution donut,
 *   - the top bottleneck stages (longest dwell).
 * Every state (loading / empty / degraded / unauthorized) renders without ever
 * blocking the page (async-frontends doctrine).
 */

// Time-range presets: [label, hours, buckets].
const RANGES = [
  ['24h', 24, 24],
  ['3d', 72, 36],
  ['7d', 168, 42],
]

// Status-slug → semantic group (drives the donut + colouring).
const DONE = new Set(['completed', 'done', 'resolved', 'closed', 'merged', 'applied'])
const DROPPED = new Set(['cancelled', 'canceled', 'rejected', 'duplicate', 'wont_fix', 'failed', 'expired', 'deferred'])
const WAITING = new Set(['blocked', 'scheduled'])
const ACTIVE = new Set(['in_progress', 'in_review', 'implementing', 'review', 'verification', 'awaiting_merge', 'accepted', 'rfc_design', 'rfc_implementation', 'under_review', 'documenting'])

const GROUP_META = {
  done: { label: 'Done', color: '#10b981' },       // emerald
  active: { label: 'In progress', color: '#6366f1' }, // brand/indigo
  waiting: { label: 'Blocked / waiting', color: '#f59e0b' }, // amber
  todo: { label: 'To do', color: '#94a3b8' },      // slate
  dropped: { label: 'Dropped', color: '#f43f5e' }, // rose
}

function groupOf(slug) {
  const s = String(slug || '').toLowerCase()
  if (DONE.has(s)) return 'done'
  if (DROPPED.has(s)) return 'dropped'
  if (WAITING.has(s)) return 'waiting'
  if (ACTIVE.has(s)) return 'active'
  return 'todo'
}

function fmtDwell(seconds) {
  if (seconds == null) return '—'
  const h = seconds / 3600
  if (h >= 48) return `${Math.round(h / 24)}d`
  if (h >= 1) return `${h.toFixed(1)}h`
  return `${Math.round(seconds / 60)}m`
}

// ---- health assessment -----------------------------------------------------
function assessHealth(snapshot) {
  const s = snapshot || {}
  const created = s.created_window || 0
  const completed = s.completed_window || 0
  const blocked = s.blocked || 0
  const overdue = s.overdue || 0
  const inFlight = s.in_progress || 0
  const ratio = created > 0 ? completed / created : (completed > 0 ? 1.5 : 1)

  // Red: intake with nothing resolving, or blocked dominating the flow.
  if ((created >= 5 && completed === 0) || (inFlight + blocked > 0 && blocked / (inFlight + blocked) > 0.5 && blocked >= 5)) {
    return { level: 'red', label: 'Needs attention', reason: created >= 5 && completed === 0
      ? 'Work is coming in but nothing is resolving' : 'A large share of work is blocked' }
  }
  // Amber: falling behind intake, or some blocked/overdue.
  if (ratio < 0.75 || overdue > 0 || blocked > 0) {
    return { level: 'amber', label: 'Watch', reason: ratio < 0.75
      ? 'Resolving slower than new work arrives'
      : (overdue > 0 ? `${overdue} overdue` : `${blocked} blocked`) }
  }
  return { level: 'green', label: 'Healthy', reason: 'Clearing work at or above intake' }
}

const HEALTH_STYLE = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  red: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
}
const HEALTH_ICON = { green: CheckCircle2, amber: AlertTriangle, red: AlertTriangle }

// ---- SVG line chart (created vs completed per bucket) -----------------------
function TrendChart({ points }) {
  const W = 520, H = 140, PAD = 6
  const n = points.length
  const max = Math.max(1, ...points.map((p) => Math.max(p.created || 0, p.completed || 0, p.terminal || 0)))
  const x = (i) => PAD + (n <= 1 ? 0 : (i * (W - 2 * PAD)) / (n - 1))
  const y = (v) => H - PAD - ((v || 0) / max) * (H - 2 * PAD)
  const line = (key) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const areaTerminal = `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.terminal).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none" role="img"
      aria-label="Resolution-rate trend: completed versus created work per time bucket">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={PAD} x2={W - PAD} y1={PAD + g * (H - 2 * PAD)} y2={PAD + g * (H - 2 * PAD)}
          className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      {n > 1 && <path d={areaTerminal} fill="#10b981" opacity="0.08" />}
      {n > 1 && <path d={line('created')} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />}
      {n > 1 && <path d={line('completed')} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" />}
    </svg>
  )
}

// ---- SVG donut (status distribution) ---------------------------------------
function Donut({ groups, total }) {
  const R = 52, SW = 16, C = 64, CIRC = 2 * Math.PI * R
  let offset = 0
  const order = ['active', 'waiting', 'todo', 'done', 'dropped']
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 128 128" className="w-28 h-28 shrink-0 -rotate-90">
        <circle cx={C} cy={C} r={R} fill="none" strokeWidth={SW} className="stroke-gray-100 dark:stroke-gray-800" />
        {total > 0 && order.map((g) => {
          const val = groups[g] || 0
          if (!val) return null
          const frac = val / total
          const dash = frac * CIRC
          const el = (
            <circle key={g} cx={C} cy={C} r={R} fill="none" strokeWidth={SW}
              stroke={GROUP_META[g].color} strokeDasharray={`${dash} ${CIRC - dash}`}
              strokeDashoffset={-offset} />
          )
          offset += dash
          return el
        })}
      </svg>
      <div className="grid grid-cols-1 gap-1 text-xs">
        {order.filter((g) => (groups[g] || 0) > 0).map((g) => (
          <div key={g} className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: GROUP_META[g].color }} />
            <span className="text-gray-600 dark:text-gray-300">{GROUP_META[g].label}</span>
            <span className="ml-auto font-medium text-gray-900 dark:text-gray-100 tabular-nums">{groups[g]}</span>
          </div>
        ))}
        {total === 0 && <span className="text-gray-400">No open work</span>}
      </div>
    </div>
  )
}

function Kpi({ label, value, tone = 'default', sub }) {
  const tones = {
    default: 'text-gray-900 dark:text-gray-100',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
    brand: 'text-brand-600 dark:text-brand-400',
  }
  return (
    <div className="rounded-lg bg-gray-50/70 dark:bg-gray-800/40 px-3 py-2">
      <div className={`text-xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</div>}
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/50 backdrop-blur p-4 ${className}`}>
      {children}
    </div>
  )
}

export default function OrgProgressCharts({ orgs, orgId, onOrgChange, range, onRangeChange }) {
  const [, hours, buckets] = RANGES.find((r) => r[0] === range) || RANGES[0]
  const { data, status, loading, refresh } = useOrgProgress({ orgId, hours, buckets, days: 7 })

  const ts = data?.timeseries
  const points = ts?.points || []
  const snapshot = data?.snapshot || {}
  const health = useMemo(() => assessHealth(snapshot), [snapshot])
  const HealthIcon = HEALTH_ICON[health.level]

  const groups = useMemo(() => {
    const g = { done: 0, active: 0, waiting: 0, todo: 0, dropped: 0 }
    // Donut shows OPEN (non-done) distribution — done work isn't "where work sits".
    for (const [slug, count] of Object.entries(data?.by_status || {})) {
      const grp = groupOf(slug)
      if (grp === 'done') continue
      g[grp] += count || 0
    }
    return g
  }, [data])
  const openTotal = groups.active + groups.waiting + groups.todo + groups.dropped

  const bottlenecks = useMemo(() => {
    const rows = (data?.throughput || [])
      .filter((r) => !DONE.has(String(r.status).toLowerCase()) && (r.avg_dwell_seconds || 0) > 0)
      .sort((a, b) => (b.avg_dwell_seconds || 0) - (a.avg_dwell_seconds || 0))
      .slice(0, 5)
    const max = Math.max(1, ...rows.map((r) => r.avg_dwell_seconds || 0))
    return { rows, max }
  }, [data])

  return (
    <div className="space-y-3">
      {/* Header: title, org picker, range toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Org progress</h3>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {Array.isArray(orgs) && orgs.length > 1 && (
            <select
              value={orgId ?? ''}
              onChange={(e) => onOrgChange?.(Number(e.target.value))}
              className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name || `Organization ${o.id}`}</option>
              ))}
            </select>
          )}
          <div className="flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            {RANGES.map(([label]) => (
              <button
                key={label}
                onClick={() => onRangeChange?.(label)}
                className={`text-[11px] px-2 py-1 ${range === label
                  ? 'bg-brand-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >{label}</button>
            ))}
          </div>
          <button onClick={refresh} title="Refresh"
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {status === 'unauthorized' ? (
        <Card><div className="text-sm text-gray-500 dark:text-gray-400">You don't have access to this org's progress.</div></Card>
      ) : status === 'degraded' ? (
        <Card><div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4" /> Progress metrics are temporarily unavailable.
        </div></Card>
      ) : status === 'empty' ? (
        <Card><div className="text-sm text-gray-500 dark:text-gray-400">No task activity in this window yet.</div></Card>
      ) : loading && !data ? (
        <Card><div className="h-40 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /></Card>
      ) : (
        <>
          {/* Health banner */}
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${HEALTH_STYLE[health.level]}`}>
            <HealthIcon className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold">{health.label}</span>
            <span className="text-xs opacity-80">· {health.reason}</span>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            <Kpi label={`resolved · ${range}`} value={snapshot.completed_window ?? 0} tone="good" />
            <Kpi label={`created · ${range}`} value={snapshot.created_window ?? 0} tone="brand" />
            <Kpi label="in flight" value={snapshot.in_progress ?? 0} />
            <Kpi label="blocked" value={snapshot.blocked ?? 0} tone={snapshot.blocked ? 'warn' : 'default'} />
            <Kpi label="overdue" value={snapshot.overdue ?? 0} tone={snapshot.overdue ? 'bad' : 'default'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Trend */}
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                  <Activity className="w-3.5 h-3.5 text-brand-500" /> Resolution rate
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" /> completed</span>
                  <span className="flex items-center gap-1 text-brand-600 dark:text-brand-400">
                    <span className="w-2.5 h-0.5 bg-brand-500 inline-block" /> created</span>
                </div>
              </div>
              <TrendChart points={points} />
            </Card>

            {/* Status donut */}
            <Card>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">Where work sits ({openTotal} open)</div>
              <Donut groups={groups} total={openTotal} />
            </Card>
          </div>

          {/* Bottlenecks */}
          {bottlenecks.rows.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Timer className="w-3.5 h-3.5 text-amber-500" /> Slowest stages (avg dwell)
              </div>
              <div className="space-y-1.5">
                {bottlenecks.rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate text-gray-600 dark:text-gray-300">
                      {r.team || '—'} <span className="text-gray-400">/ {r.status}</span>
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400/80"
                        style={{ width: `${Math.max(4, ((r.avg_dwell_seconds || 0) / bottlenecks.max) * 100)}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums text-gray-500 dark:text-gray-400">{fmtDwell(r.avg_dwell_seconds)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
