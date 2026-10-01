import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ACCESS_TOKEN_KEY, USER_KEY } from '../utils/auth'

function Probe() {
  const { isLoading, isAuthenticated, user } = useAuth()
  if (isLoading) return <span>loading</span>
  return (
    <span data-auth={String(isAuthenticated)} data-user={user ? 'yes' : 'no'}>
      ready
    </span>
  )
}

function fakeJwt(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `hdr.${b64}.sig`
}

describe('AuthProvider logged-out public pages', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('location', {
      ...window.location,
      assign: vi.fn(),
      pathname: '/forge/',
      search: '',
      hash: '',
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('does not throw on a missing access token and stays anonymous', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(screen.getByText('ready')).toHaveAttribute('data-auth', 'false')
    expect(screen.getByText('ready')).toHaveAttribute('data-user', 'no')
  })

  // FRG-72: expired ID JWT must not force /id/login on public routes.
  it('clears an expired access token without redirecting to /id/login', async () => {
    const expired = fakeJwt({
      user_id: 1,
      email: 'stale@example.com',
      exp: Math.floor(Date.now() / 1000) - 3600,
    })
    localStorage.setItem(ACCESS_TOKEN_KEY, expired)
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, email: 'stale@example.com' }))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(screen.getByText('ready')).toHaveAttribute('data-auth', 'false')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(window.location.assign).not.toHaveBeenCalled()
  })
})
