import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

function Probe() {
  const { isLoading, isAuthenticated, user } = useAuth()
  if (isLoading) return <span>loading</span>
  return (
    <span data-auth={String(isAuthenticated)} data-user={user?.username || ''}>
      ready
    </span>
  )
}

describe('AuthProvider cookie session', () => {
  afterEach(() => {
    document.cookie = 'shizuha-access-token=; Max-Age=0'
    vi.unstubAllGlobals()
  })

  it('shows the signed-in user when localStorage is empty and the cookie session is live', async () => {
    document.cookie = 'shizuha-access-token=present'
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/hive/api/v1/me') {
        return { ok: true, json: async () => ({ username: 'hiro', is_staff: false }) }
      }
      return { ok: false, json: async () => ({}) }
    }))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(screen.getByText('ready')).toHaveAttribute('data-auth', 'true')
    expect(screen.getByText('ready')).toHaveAttribute('data-user', 'hiro')
  })
})
