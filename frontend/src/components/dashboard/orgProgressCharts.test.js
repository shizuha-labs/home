import { isSlowestStageRow } from './orgProgressStages.js'

describe('isSlowestStageRow', () => {
  const row = (status, extra = {}) => ({
    status,
    avg_dwell_seconds: 86400,
    samples: 1,
    ...extra,
  })

  it('keeps live flow stages', () => {
    expect(isSlowestStageRow(row('in_review'))).toBe(true)
    expect(isSlowestStageRow(row('awaiting_deploy'))).toBe(true)
    expect(isSlowestStageRow(row('needs_triage'))).toBe(true)
  })

  it('drops intake and terminal-ish statuses that are not flow stalls', () => {
    expect(isSlowestStageRow(row('todo'))).toBe(false)
    expect(isSlowestStageRow(row('open'))).toBe(false)
    expect(isSlowestStageRow(row('proposed'))).toBe(false)
    expect(isSlowestStageRow(row('change_rejected'))).toBe(false)
    expect(isSlowestStageRow(row('applied'))).toBe(false)
    expect(isSlowestStageRow(row('scheduled'))).toBe(false)
  })

  it('drops parking and zero-dwell rows', () => {
    expect(isSlowestStageRow(row('in_progress', { is_parking: true }))).toBe(false)
    expect(isSlowestStageRow(row('in_progress', { avg_dwell_seconds: 0 }))).toBe(false)
  })
})
