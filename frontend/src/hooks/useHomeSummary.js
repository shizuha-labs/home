import { useCallback, useMemo } from 'react'
import { useHomeWidgetFeed } from './useHomeWidgetFeed'

/**
 * HIVE-376 / HIVE-375: fetch the command-center `HomeSummaryV1` from the home
 * aggregation BFF (`GET /api/home/summary`). Contract (aoi-approved on HIVE-375):
 *
 *   { version: 1, generated_at, org_id,
 *     orgs: [{ id, name, role }],
 *     widgets: {
 *       agent_activity:       { status, as_of, data },
 *       tasks_by_status:      { status, as_of, data },
 *       financial_snapshot:   { status, as_of, data },   // status="unauthorized" hides P&L
 *       alerts:               { status, as_of, data },
 *       recent_conversations: { status, as_of, data },
 *     } }
 *
 * Each widget carries its own `status` (ok | degraded | stale | unauthorized |
 * empty) so the UI hydrates each independently and NEVER blocks the page — the
 * async-frontends doctrine. The BFF always returns 200 (partial); a slow/failed
 * source degrades ONE widget, not the whole call. Until the HIVE-375 backend
 * lands, the endpoint 404s / errors → we surface every widget as `degraded`
 * (loading state) rather than crashing, so this frontend ships in parallel.
 */

export const SUMMARY_ENDPOINT = '/api/home/summary'

// The widget keys the dashboard renders, in display order.
export const WIDGET_KEYS = [
  'agent_activity',
  'tasks_by_status',
  'financial_snapshot',
  'alerts',
  'recent_conversations',
]

/**
 * @param {{ orgId?: string, refreshMs?: number }} [opts]
 * @returns {{ summary: object|null, loading: boolean, error: Error|null,
 *   widget: (key: string) => {status: string, as_of?: string, data?: any},
 *   refresh: () => void }}
 */
export function useHomeSummary({ orgId, refreshMs = 30000, enabled = true } = {}) {
  const feed = useHomeWidgetFeed({ endpoint: `${SUMMARY_ENDPOINT}?background=1`, orgId, refreshMs, enabled })
  // Books authorization is checked afresh for every financial read. This
  // independent source must not hold the nonfinancial summary or reuse finance
  // across visits, failed refreshes, or changed authorization.
  const finance = useHomeWidgetFeed({ endpoint: '/api/home/financial', orgId, refreshMs, enabled, widgetName: 'financial_snapshot', retain: false })
  const financialWidget = finance.widget('financial_snapshot')
  const summary = useMemo(() => feed.payload ? {
    ...feed.payload, widgets: { ...feed.payload.widgets, financial_snapshot: financialWidget },
  } : null, [feed.payload, financialWidget])
  const { widget: feedWidget, refresh: refreshFeed } = feed
  const { refresh: refreshFinance } = finance
  const widget = useCallback((name) => name === 'financial_snapshot' ? financialWidget : feedWidget(name), [financialWidget, feedWidget])
  const refresh = useCallback(() => Promise.all([refreshFeed(), refreshFinance()]), [refreshFeed, refreshFinance])
  return { summary, loading: feed.loading, error: feed.error, widget, refresh }
}
