import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { AuthProvider } from '../contexts/AuthContext'
import { ACCESS_TOKEN_KEY, USER_KEY } from '../utils/auth'

vi.mock('../components/shared/GlobalNavBar', () => ({
  default: () => <nav data-testid="nav">nav</nav>,
}))
vi.mock('../components/Footer', () => ({
  default: () => <footer data-testid="footer">footer</footer>,
}))
vi.mock('../utils/analytics', () => ({
  trackPlausibleEvent: () => {},
}))

function fakeJwt(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `hdr.${b64}.sig`
}

describe('FRG-72 public /forge landing', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    vi.stubGlobal('location', {
      ...window.location,
      assign: vi.fn(),
      replace: vi.fn(),
      pathname: '/forge/',
      search: '',
      hash: '',
      href: 'https://shizuha.com/forge/',
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('renders the image-API landing for anonymous visitors', async () => {
    render(
      <MemoryRouter initialEntries={['/forge/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText(/Programmable AI image generation/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Get a key below/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Pay-as-you-go/i).length).toBeGreaterThan(0)
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('keeps the Forge landing when localStorage has an expired ID JWT', async () => {
    const expired = fakeJwt({
      user_id: 9,
      email: 'stale@example.com',
      exp: Math.floor(Date.now() / 1000) - 7200,
    })
    localStorage.setItem(ACCESS_TOKEN_KEY, expired)
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 9, email: 'stale@example.com' }))

    render(
      <MemoryRouter initialEntries={['/forge/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText(/Programmable AI image generation/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/10 images\/day free/i)).toBeInTheDocument()
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(window.location.assign).not.toHaveBeenCalled()
  })
})
