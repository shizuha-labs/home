/**
 * Live calls live in ChatHome. `/` and `/c/:id` must share one shell so
 * opening a thread mid-call does not remount ChatHome and kill the session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

const mounts = { n: 0 }

vi.mock('../pages/ChatHome', () => {
  const React = require('react')
  return {
    default: function ChatHome() {
      const seen = React.useRef(false)
      if (!seen.current) {
        seen.current = true
        mounts.n += 1
      }
      return React.createElement('div', { 'data-testid': 'chat-home' }, String(mounts.n))
    },
  }
})

vi.mock('../pages/LandingPage', () => ({
  default: () => createElement('div', { 'data-testid': 'landing' }, 'landing'),
}))

vi.mock('../components/shared/GlobalNavBar', () => ({
  default: () => createElement('nav', { 'data-testid': 'nav' }, 'nav'),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true, user: { id: 1 } }),
}))

import App from '../App'

function OpenThread() {
  const navigate = useNavigate()
  return createElement('button', { type: 'button', onClick: () => navigate('/c/abc') }, 'open thread')
}

describe('live call route mount', () => {
  beforeEach(() => {
    mounts.n = 0
  })

  it('keeps ChatHome mounted when navigating from dashboard to a thread', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <OpenThread />
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('chat-home')).toHaveTextContent('1')
    act(() => {
      screen.getByRole('button', { name: 'open thread' }).click()
    })
    expect(screen.getByTestId('chat-home')).toHaveTextContent('1')
    expect(mounts.n).toBe(1)
  })
})
