import { useNavigate } from 'react-router-dom'
import {
  Bell, Plus,
} from 'lucide-react'
import { cn } from '../../utils/cn'
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

function WidgetShell({ title, icon: Icon, status, children, action }) {
  return (
    <section
      className="flex flex-col rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white/70 dark:bg-gray-900/50 backdrop-blur-sm p-4 min-h-[7.5rem]"
      aria-busy={status === 'loading'}
    >
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          {Icon ? <Icon className="w-4 h-4" /> : null}
          <h3 className="text-xs font-semibold uppercase tracking-wider">{title}</h3>
        </div>
        {action}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  )
}

function Skeleton({ rows = 2 }) {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-gray-200/80 dark:bg-gray-700/60" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  )
}

function Muted({ children }) {
  return <p className="text-xs text-gray-400 dark:text-gray-500">{children}</p>
}

// Render a widget body by its per-widget status, delegating the `ok` case to `render`.
function ByStatus({ status, render, empty, unauthorized }) {
  switch (status) {
    case 'loading':
      return <Skeleton />
    case 'ok':
    case 'stale':
      return (
        <>
          {render()}
          {status === 'stale' ? <Muted>Showing cached data…</Muted> : null}
        </>
      )
    case 'unauthorized':
      return (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <Lock className="w-3.5 h-3.5" /> {unauthorized || 'Not authorized to view this.'}
        </div>
      )
    case 'empty':
      return empty || <Muted>Nothing yet.</Muted>
    default: // degraded / unknown
      return (
        <div className="flex items-center gap-2 text-xs text-amber-500/90">
          <AlertTriangle className="w-3.5 h-3.5" /> Temporarily unavailable.
        </div>
      )
  }
}

function num(v) {
  return typeof v === 'number' ? v : 0
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
  const { summary, widget } = useHomeSummary({ orgId })

  const orgs = Array.isArray(summary?.orgs) ? summary.orgs : null
  const tasks = widget('tasks_by_status')
  const money = widget('financial_snapshot')
  const alerts = widget('alerts')

  const t = tasks.data || {}
  const inFlight = (t.open || 0) + (t.in_progress || 0) + (t.in_review || 0) + (t.awaiting_merge || 0)
  const blocked = t.blocked || 0
  const finOrg = money.data?.org_id != null
    ? (orgs || []).find((o) => String(o.id) === String(money.data.org_id))
    : null
  const alertItems = Array.isArray(alerts.data) ? alerts.data : []

  // HIVE-602 bloat cut v2 (operator): the tile grid read as static filler
  // next to the live theater — everything folds into ONE slim strip of live
  // facts. Org chips still open the org peek; counts deep-link to Pulse/Books.
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        {orgs && orgs.length === 0 && (
          <button
            onClick={() => navigate('/hive')}
            className="flex items-center gap-2 rounded-xl border border-dashed border-brand-300 px-3 py-1.5 font-medium text-brand-600 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-400 dark:hover:bg-brand-950/30"
          >
            <Plus className="h-3.5 w-3.5" /> Create your organization
          </button>
        )}
        {(orgs || []).map((o) => (
          <button
            key={o.id}
            title={`${orgName(o)} — peek teams & agents`}
            onClick={() => (onPeekOrg ? onPeekOrg(o) : navigate(`/hive/agents?org=${encodeURIComponent(o.slug || o.id)}`))}
            className="group flex items-center gap-1.5 rounded-full bg-white/60 px-2.5 py-1 ring-1 ring-gray-200/60 backdrop-blur-sm transition-colors hover:ring-brand-300 dark:bg-gray-900/50 dark:ring-gray-700/40 dark:hover:ring-brand-700"
          >
            <span className="flex h-4.5 w-5 items-center justify-center rounded-md bg-brand-100 text-[9px] font-bold text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
              {orgName(o).slice(0, 1).toUpperCase()}
            </span>
            <span className="font-medium text-gray-700 group-hover:text-brand-700 dark:text-gray-200 dark:group-hover:text-brand-300">
              {orgName(o)}
            </span>
          </button>
        ))}
        {tasks.status === 'ok' && (
          <button onClick={() => navigate(DEEP_LINKS.pulse)} className="hover:text-brand-600 dark:hover:text-brand-400">
            <b className="text-gray-800 dark:text-gray-100">{inFlight}</b> in flight
            {blocked > 0 && <> · <b className="text-amber-600 dark:text-amber-400">{blocked}</b> blocked</>}
          </button>
        )}
        {money.status === 'ok' && typeof money.data?.cash === 'number' && (
          <button onClick={() => navigate(DEEP_LINKS.books)} className="hover:text-brand-600 dark:hover:text-brand-400">
            <b className="text-gray-800 dark:text-gray-100">{formatMoney(money.data.cash, money.data.currency)}</b>
            {typeof money.data?.period_net === 'number' && <> · net {formatMoney(money.data.period_net, money.data.currency)}</>}
            {finOrg?.name ? <span className="text-gray-400 dark:text-gray-500"> ({finOrg.name})</span> : null}
          </button>
        )}
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
