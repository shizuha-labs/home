import { useNavigate } from 'react-router-dom'
import {
  Bell, Plus,
} from 'lucide-react'
import { useHomeSummary } from '../../hooks/useHomeSummary'

/**
 * HIVE-376: the command-center dashboard — a concise, live, access-scoped picture
 * of the signed-in user's world, rendered AROUND the central chat (chat stays the
 * heart). Each widget hydrates independently from the HIVE-375 `HomeSummaryV1`
 * aggregation API and renders its own status (loading → skeleton, ok → data,
 * empty → guidance/CTA, degraded/stale → muted notice, unauthorized → locked), so
 * a slow/absent source degrades ONE card and never blocks the page
 * (async-frontends doctrine). Ships in parallel with the HIVE-375 backend.
 */

const DEEP_LINKS = {
  pulse: '/pulse',
  books: '/books',
}

function orgName(o) {
  return o?.name || (o?.id ? `Organization ${o.id}` : 'Organization')
}

function formatMoney(value, currency = 'INR') {
  if (typeof value !== 'number') return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

export default function CommandCenterDashboard({ orgId, onPeekOrg }) {
  const navigate = useNavigate()
  const { summary, widget, refresh } = useHomeSummary({ orgId })

  const orgs = Array.isArray(summary?.orgs) ? summary.orgs : null
  const agents = widget('agent_activity')
  const tasks = widget('tasks_by_status')
  const money = widget('financial_snapshot')
  const alerts = widget('alerts')

  const agentData = agents.data || {}
  const t = tasks.data || {}
  const inFlight = (t.open || 0) + (t.in_progress || 0) + (t.in_review || 0) + (t.awaiting_merge || 0)
  const blocked = t.blocked || 0
  const finOrg = money.data?.org_id != null
    ? (orgs || []).find((o) => String(o.id) === String(money.data.org_id))
    : null
  const alertItems = Array.isArray(alerts.data) ? alerts.data : []

  // HIVE-602: the status dock — one segmented glass bar (matching the theater
  // panels) instead of loose text lines: org avatars (click = org peek), agent
  // activity, work queue, money, and attention. Empty and unavailable are real
  // states — never an endless "retrying" placeholder (HIVE-573).
  return (
    <div className="w-full">
      <div className="flex justify-center">
        <div className="flex items-stretch divide-x divide-gray-200/60 rounded-2xl bg-white/60 px-1 py-1.5 ring-1 ring-gray-200/60 backdrop-blur-sm dark:divide-gray-700/40 dark:bg-gray-900/50 dark:ring-gray-700/40">
          <div className="flex items-center gap-1.5 px-3">
            {orgs === null ? (
              <span className="h-8 w-24 animate-pulse rounded-lg bg-gray-200/70 dark:bg-gray-700/50" />
            ) : orgs.length === 0 ? (
              <button
                onClick={() => navigate('/hive')}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                <Plus className="h-3.5 w-3.5" /> Create your organization
              </button>
            ) : (
              orgs.map((o) => (
                <button
                  key={o.id}
                  title={`${orgName(o)} — peek teams & agents`}
                  onClick={() => (onPeekOrg ? onPeekOrg(o) : navigate(`/hive/agents?org=${encodeURIComponent(o.slug || o.id)}`))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-100 to-purple-100 text-xs font-bold text-brand-700 ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:ring-brand-400 dark:from-brand-950/70 dark:to-purple-950/70 dark:text-brand-300"
                >
                  {orgName(o).slice(0, 1).toUpperCase()}
                </button>
              ))
            )}
          </div>
          {agents.status === 'loading' ? (
            <div className="flex items-center px-4" aria-label="Loading agent activity">
              <span className="h-7 w-20 animate-pulse rounded-lg bg-gray-200/70 dark:bg-gray-700/50" />
            </div>
          ) : agents.status === 'ok' || agents.status === 'stale' ? (
            <button onClick={() => navigate('/hive/agents')} className="group px-4 text-left">
              <p className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                {agentData.active || 0} <span className="font-normal text-gray-500 dark:text-gray-400">live</span>
                {typeof agentData.total === 'number' && (
                  <> <span className="text-gray-300 dark:text-gray-600">·</span> {agentData.total} <span className="font-normal text-gray-500 dark:text-gray-400">total</span></>
                )}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">
                Agent activity{agents.status === 'stale' ? ' · cached' : ''}
              </p>
            </button>
          ) : agents.status === 'empty' ? (
            <button onClick={() => navigate('/hive/agents')} className="group px-4 text-left">
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No agents</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">Agent activity</p>
            </button>
          ) : agents.status === 'unauthorized' ? (
            <div className="px-4 text-left">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Scoped</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Agent activity</p>
            </div>
          ) : (
            <button onClick={refresh} className="group px-4 text-left" title="Retry agent activity snapshot">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Unavailable</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">Agent activity · retry</p>
            </button>
          )}
          {tasks.status === 'ok' && (
            <button onClick={() => navigate(DEEP_LINKS.pulse)} className="group px-4 text-left">
              <p className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                {inFlight} <span className="font-normal text-gray-500 dark:text-gray-400">in flight</span>
                {blocked > 0 && (
                  <> <span className="text-gray-300 dark:text-gray-600">·</span> <span className="text-amber-600 dark:text-amber-400">{blocked}</span> <span className="font-normal text-gray-500 dark:text-gray-400">blocked</span></>
                )}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">Work queue</p>
            </button>
          )}
          {money.status === 'ok' && typeof money.data?.cash === 'number' && (
            <button onClick={() => navigate(DEEP_LINKS.books)} className="group px-4 text-left">
              <p className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                {formatMoney(money.data.cash, money.data.currency)}
                {typeof money.data?.period_net === 'number' && (
                  <span className={money.data.period_net < 0 ? 'font-normal text-red-500/80' : 'font-normal text-emerald-600'}>
                    {' '}{money.data.period_net < 0 ? '▾' : '▴'} {formatMoney(Math.abs(money.data.period_net), money.data.currency)}
                  </span>
                )}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">
                {finOrg?.name || 'Books'}
              </p>
            </button>
          )}
          {alerts.status === 'loading' ? (
            <div className="flex items-center px-4" aria-label="Loading attention items">
              <span className="h-7 w-16 animate-pulse rounded-lg bg-gray-200/70 dark:bg-gray-700/50" />
            </div>
          ) : alerts.status === 'ok' || alerts.status === 'stale' ? (
            <button onClick={() => navigate(DEEP_LINKS.pulse)} className="group px-4 text-left">
              <p className={alertItems.length ? 'text-sm font-semibold text-amber-600 dark:text-amber-400' : 'text-sm font-semibold text-emerald-600 dark:text-emerald-400'}>
                {alertItems.length ? `${alertItems.length} active` : 'All clear'}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">
                Attention{alerts.status === 'stale' ? ' · cached' : ''}
              </p>
            </button>
          ) : alerts.status === 'empty' ? (
            <button onClick={() => navigate(DEEP_LINKS.pulse)} className="group px-4 text-left">
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">All clear</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">Attention</p>
            </button>
          ) : alerts.status === 'unauthorized' ? (
            <div className="px-4 text-left">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Restricted</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Attention</p>
            </div>
          ) : (
            <button onClick={refresh} className="group px-4 text-left" title="Retry attention snapshot">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Unavailable</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-brand-500 dark:text-gray-500">Attention · retry</p>
            </button>
          )}
        </div>
      </div>
      {(alerts.status !== 'empty' && alertItems.length > 0) && (
        <div className="mt-3 flex justify-center">
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 text-xs text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
            <Bell className="h-3.5 w-3.5" />
            {alertItems.slice(0, 2).map((a, i) => (
              <span key={i} className="truncate">{a.summary}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
