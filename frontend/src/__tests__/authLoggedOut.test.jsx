import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

function Probe() {
  const { isLoading, isAuthenticated, user } = useAuth()
  if (isLoading) return <span>loading</span>
  return (
    <span data-auth={String(isAuthenticated)} data-user={user ? 'yes' : 'no'}>
      ready
    </span>
  )
}

describe('AuthProvider logged-out public pages', () => {
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
})
