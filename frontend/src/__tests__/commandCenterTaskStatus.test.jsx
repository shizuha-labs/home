import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CommandCenterDashboard from '../components/dashboard/CommandCenterDashboard'
import { useHomeSummary } from '../hooks/useHomeSummary'

vi.mock('../hooks/useHomeSummary', () => ({
  useHomeSummary: vi.fn(),
}))

const ZERO_COUNTS = {
  open: 0,
  in_progress: 0,
  in_review: 0,
  blocked: 0,
  awaiting_merge: 0,
}

function renderDashboard(tasks) {
  const refresh = vi.fn()
  useHomeSummary.mockReturnValue({
    summary: { orgs: [] },
    refresh,
    widget: (key) => (key === 'tasks_by_status' ? tasks : { status: 'empty', data: [] }),
  })
  render(
    <MemoryRouter>
      <CommandCenterDashboard />
    </MemoryRouter>,
  )
  return refresh
}

describe('CommandCenterDashboard task-status states', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['a degraded envelope', { status: 'degraded', data: Object.fromEntries(Object.keys(ZERO_COUNTS).map((key) => [key, null])) }],
    ['an incomplete count snapshot', { status: 'ok', data: { ...ZERO_COUNTS, blocked: null } }],
  ])('renders %s as unavailable, never as empty activity', (_label, tasks) => {
    renderDashboard(tasks)

    const retryLabel = screen.getByText('Work queue · retry')
    expect(retryLabel.parentElement).toHaveTextContent('Unavailable')
    expect(screen.queryByText('No task activity')).not.toBeInTheDocument()
  })

  it('keeps a complete healthy all-zero snapshot as honest empty activity', () => {
    renderDashboard({ status: 'ok', data: ZERO_COUNTS })

    expect(screen.getByText('No task activity')).toBeInTheDocument()
    expect(screen.getByText('Work queue')).toBeInTheDocument()
    expect(screen.queryByText('Work queue · retry')).not.toBeInTheDocument()
  })

  it('renders the backend empty envelope as honest empty activity', () => {
    renderDashboard({ status: 'empty', data: null })

    expect(screen.getByText('No task activity')).toBeInTheDocument()
    expect(screen.queryByText('Work queue · retry')).not.toBeInTheDocument()
  })
})
