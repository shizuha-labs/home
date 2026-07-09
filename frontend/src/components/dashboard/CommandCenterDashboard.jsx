import { useNavigate } from 'react-router-dom'
import {
  Building2, Bot, ListTodo, Wallet, Bell, Lock, AlertTriangle, ChevronRight, Plus,
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

export default function CommandCenterDashboard({ orgId }) {
  const navigate = useNavigate()
  const { summary, widget } = useHomeSummary({ orgId })

  const orgs = Array.isArray(summary?.orgs) ? summary.orgs : null
  const agent = widget('agent_activity')
  const tasks = widget('tasks_by_status')
  const money = widget('financial_snapshot')
  const alerts = widget('alerts')

  return (
    <div className="w-full">
      {/* My organizations */}
      <div className="mb-3">
        {orgs === null ? (
          <div className="flex gap-2"><div className="h-16 w-40 rounded-2xl bg-gray-200/70 dark:bg-gray-700/50 animate-pulse" /><div className="h-16 w-40 rounded-2xl bg-gray-200/60 dark:bg-gray-700/40 animate-pulse" /></div>
        ) : orgs.length === 0 ? (
          <button
            onClick={() => navigate('/hive')}
            className="flex items-center gap-2 rounded-2xl border border-dashed border-brand-300 dark:border-brand-800 px-4 py-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
          >
            <Plus className="w-4 h-4" /> Create your organization
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate(`/hive/agents?org=${encodeURIComponent(o.slug || o.id)}`)}
                className="group flex items-center gap-2 rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white/70 dark:bg-gray-900/50 px-4 py-2.5 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
              >
                <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 text-xs font-bold">
                  {orgName(o).slice(0, 1).toUpperCase()}
                </span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{orgName(o)}</span>
                {o.role ? <span className="text-[10px] uppercase tracking-wide text-gray-400">{o.role}</span> : null}
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-400 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Widget grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <WidgetShell title="Agent activity" icon={Bot} status={agent.status}>
          <ByStatus status={agent.status} render={() => (
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{num(agent.data?.active)}</span>
              <span className="text-xs text-gray-500">working now</span>
              {num(agent.data?.error) > 0 ? (
                <span className="ml-auto text-xs font-medium text-red-500">{num(agent.data.error)} stuck</span>
              ) : null}
              {num(agent.data?.stopped) > 0 ? (
                <span className="ml-auto text-xs font-medium text-gray-400">{num(agent.data.stopped)} stopped</span>
              ) : null}
            </div>
          )} empty={<Muted>No agents yet.</Muted>} unauthorized="Fleet activity is not shared with you." />
        </WidgetShell>

        <WidgetShell
          title="Pending work"
          icon={ListTodo}
          status={tasks.status}
          action={<button onClick={() => navigate(DEEP_LINKS.pulse)} className="text-[11px] text-brand-500 hover:underline">Open</button>}
        >
          <ByStatus status={tasks.status} render={() => (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {/* Buckets match the HIVE-375 BFF _TASK_BUCKETS (incl. awaiting_merge). */}
              {['open', 'in_progress', 'in_review', 'blocked', 'awaiting_merge'].map((k) => (
                <span key={k} className="text-gray-600 dark:text-gray-300">
                  <b className="text-gray-900 dark:text-gray-100">{num(tasks.data?.[k])}</b> {k.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )} empty={<Muted>Nothing pending on you.</Muted>} />
        </WidgetShell>

        <WidgetShell
          title="Financials"
          icon={Wallet}
          status={money.status}
          action={money.status === 'ok' ? <button onClick={() => navigate(DEEP_LINKS.books)} className="text-[11px] text-brand-500 hover:underline">Books</button> : null}
        >
          <ByStatus status={money.status} unauthorized="Financials not shared with you." render={() => {
            const finOrg = money.data?.org_id != null
              ? (orgs || []).find((o) => String(o.id) === String(money.data.org_id))
              : null
            return (
              <div>
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatMoney(money.data?.cash, money.data?.currency)}
                </div>
                <Muted>Net this period: {formatMoney(money.data?.period_net, money.data?.currency)}</Muted>
                {finOrg?.name ? <Muted>{finOrg.name}</Muted> : null}
              </div>
            )
          }} empty={<Muted>Select an organization to view financials.</Muted>} />
        </WidgetShell>

        <WidgetShell title="Attention" icon={Bell} status={alerts.status}>
          <ByStatus status={alerts.status} render={() => {
            const items = Array.isArray(alerts.data) ? alerts.data : []
            if (items.length === 0) return <Muted>All clear.</Muted>
            return (
              <ul className="space-y-1">
                {items.slice(0, 3).map((a, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                    <span className={cn('w-1.5 h-1.5 rounded-full', a.sev === 'high' ? 'bg-red-500' : 'bg-amber-400')} />
                    <span className="truncate">{a.summary}</span>
                  </li>
                ))}
              </ul>
            )
          }} empty={<Muted>All clear.</Muted>} />
        </WidgetShell>
      </div>
    </div>
  )
}

export { CommandCenterDashboard, WidgetShell, ByStatus }
