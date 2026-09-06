const DONE = new Set(['completed', 'done', 'resolved', 'closed', 'merged', 'applied'])
const DROPPED = new Set(['cancelled', 'canceled', 'rejected', 'duplicate', 'wont_fix', 'failed', 'expired', 'deferred', 'change_rejected'])
const WAITING = new Set(['blocked', 'scheduled'])
const INTAKE = new Set(['todo', 'open', 'proposed', 'found'])

export function isSlowestStageRow(row) {
  const s = String(row?.status || '').toLowerCase()
  if (DONE.has(s) || DROPPED.has(s) || WAITING.has(s) || INTAKE.has(s)) return false
  if (row?.is_parking) return false
  if (s === 'backlog' || s === 'waiting_external') return false
  return (row?.avg_dwell_seconds || 0) > 0
}
