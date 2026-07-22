import { useCallback, useState } from 'react'
import { ArrowUpCircle, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useHarnessUpgradeStatus, useHarnessUpgradeHistory, triggerHarnessUpgrade } from '../../hooks/useHarnessUpgrade'

/**
 * HIVE-615 Harness auto-upgrade panel — shows current upgrade status, recent
 * history, and a manual trigger button. Designed to be embedded in the Hive
 * harness panel or the command center dashboard.
 */

const STATUS_ICONS = {
  completed: CheckCircle2,
  rolled_back: XCircle,
  building: RefreshCw,
  canarying: Clock,
  rolling: ArrowUpCircle,
  detected: Clock,
}

const STATUS_COLORS = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  rolled_back: 'text-red-600 dark:text-red-400',
  building: 'text-brand-600 dark:text-brand-400',
  canarying: 'text-amber-600 dark:text-amber-400',
  rolling: 'text-brand-600 dark:text-brand-400',
  detected: 'text-gray-500 dark:text-gray-400',
}

function timeAgo(iso) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function UpgradeRow({ run }) {
  const Icon = STATUS_ICONS[run.status] || Clock
  const color = STATUS_COLORS[run.status] || 'text-gray-500'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white/50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/50">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
            {run.harness}
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {run.from_version} → {run.to_version}
          </span>
          <span className={cn(
            'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            run.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : run.status === 'rolled_back' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300',
          )}>
            {run.status}
          </span>
        </div>
        {run.image_tag && (
          <p className="mt-0.5 truncate text-[10px] font-mono text-gray-400 dark:text-gray-500">
            {run.image_tag}
          </p>
        )}
        <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
          {timeAgo(run.timestamp)}
          {run.canary_agent && ` · canary: ${run.canary_agent}`}
          {run.canary_result && ` · ${run.canary_result}`}
          {run.rollback_reason && (
            <span className="text-red-500"> · rollback: {run.rollback_reason}</span>
          )}
        </p>
      </div>
    </div>
  )
}

function UpgradeSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[80, 60].map((w) => (
        <div key={w} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

export default function HarnessUpgradePanel({ className }) {
  const { status, loading: statusLoading, error: statusError, refresh: refreshStatus } = useHarnessUpgradeStatus({ refreshMs: 60000 })
  const { upgrades, loading: historyLoading, refresh: refreshHistory } = useHarnessUpgradeHistory({ limit: 10 })
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState(null)

  const handleTrigger = useCallback(async () => {
    setTriggering(true)
    setTriggerResult(null)
    try {
      const result = await triggerHarnessUpgrade()
      setTriggerResult({ ok: true, count: result.upgrades_triggered })
      refreshStatus()
      refreshHistory()
    } catch (e) {
      setTriggerResult({ ok: false, error: e.message })
    } finally {
      setTriggering(false)
    }
  }, [refreshStatus, refreshHistory])

  const loading = statusLoading && historyLoading
  const level = status?.autoupgrade_level || 'patch'

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            Harness Auto-Upgrade
          </span>
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            level === 'off' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              : level === 'patch' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          )}>
            {level}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/50"
          >
            <RefreshCw className={cn('h-3 w-3', triggering && 'animate-spin')} />
            {triggering ? 'Triggering…' : 'Check now'}
          </button>
          <button
            onClick={() => { refreshStatus(); refreshHistory() }}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Trigger result */}
      {triggerResult && (
        <div className={cn(
          'rounded-lg px-3 py-2 text-xs',
          triggerResult.ok
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        )}>
          {triggerResult.ok
            ? `Upgrade cycle complete: ${triggerResult.count} upgrade(s) triggered.`
            : `Trigger failed: ${triggerResult.error}`}
        </div>
      )}

      {/* Error state */}
      {statusError && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
          Status unavailable: {statusError.message}
        </div>
      )}

      {/* Upgrade history */}
      <div className="space-y-1.5">
        {loading ? (
          <UpgradeSkeleton />
        ) : upgrades.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
            No upgrades yet. The auto-upgrade pipeline will check every 6 hours.
          </p>
        ) : (
          upgrades.map((run) => (
            <UpgradeRow key={run.id} run={run} />
          ))
        )}
      </div>

      {/* Config summary */}
      {status && (
        <div className="rounded-lg bg-gray-50/80 px-3 py-2 dark:bg-gray-800/50">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Poll interval: {Math.round((status.poll_interval_seconds || 21600) / 3600)}h
            {status.last_good_image && (
              <> · Last good: <span className="font-mono">{status.last_good_image}</span></>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
