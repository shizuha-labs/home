/**
 * Dashboard / logo must be react-router Links so `/` ↔ `/c/:id` does not
 * full-document-reload and kill a Live session.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Hritik', username: 'hritik', email: 'hritik@shizuha.com' },
  }),
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false, toggleTheme: () => {} }),
}))

vi.mock('@shizuha/ui', () => ({
  AppSwitcher: () => null,
}))

import GlobalNavBar from '../components/shared/GlobalNavBar'

function Shell() {
  return (
    <>
      <GlobalNavBar />
      <Routes>
        <Route path="/" element={createElement('div', { 'data-testid': 'home-page' }, 'home')} />
        <Route path="/c/:conversationId" element={createElement('div', { 'data-testid': 'thread-page' }, 'thread')} />
      </Routes>
    </>
  )
}

describe('GlobalNavBar SPA home links', () => {
  it('uses in-app hrefs for logo and Dashboard, not other surfaces', () => {
    render(
      <MemoryRouter initialEntries={['/c/bb516974-4152-427a-a2ac-04535b5f393f']}>
        <Shell />
      </MemoryRouter>,
    )
    const logo = screen.getByRole('link', { name: /Shizuha/i })
    expect(logo).toHaveAttribute('href', '/')
    const dashboards = screen.getAllByRole('link', { name: /Dashboard/i })
    expect(dashboards.length).toBeGreaterThan(0)
    for (const link of dashboards) {
      expect(link).toHaveAttribute('href', '/')
    }
    expect(screen.getByRole('link', { name: /Work/i })).toHaveAttribute('href', '/pulse')
    expect(screen.getByRole('link', { name: /Admin/i })).toHaveAttribute('href', '/admin')
  })

  it('Dashboard stays inside the router when leaving a thread', () => {
    render(
      <MemoryRouter initialEntries={['/c/bb516974-4152-427a-a2ac-04535b5f393f']}>
        <Shell />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('thread-page')).toBeInTheDocument()
    act(() => {
      screen.getAllByRole('link', { name: /Dashboard/i })[0].click()
    })
    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('thread-page')).not.toBeInTheDocument()
  })
})
