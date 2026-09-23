import { useHomeWidgetFeed } from './useHomeWidgetFeed'

/**
 * HIVE-602: poll the live-theater feed (`GET /api/home/activity`) — the
 * merged Pulse event stream (activity + comments across the caller's orgs)
 * plus the fleet as live entities. Fast cadence (default 8s) so the home
 * reads as live; same fail-soft widget envelope as useHomeSummary, so a slow
 * source degrades to recent history, never a blank or a crash.
 */

export const ACTIVITY_ENDPOINT = '/api/home/activity'

export function useHomeActivity({ orgId, refreshMs = 8000, enabled = true } = {}) {
  const { payload: activity, ...state } = useHomeWidgetFeed({ endpoint: ACTIVITY_ENDPOINT, orgId, refreshMs, enabled })
  return { activity, ...state }
}
