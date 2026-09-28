/**
 * VEN-265 regression gate: the Books Compliance Gate-2 GTM surfaces are
 * PUBLIC-BY-CONTRACT (VEN-165 / VEN-194). An anonymous fresh-profile visitor
 * (no cookies, no token) must land on real landing/pricing content — never
 * the Shizuha ID sign-in gate. A global auth-guard change must not be able
 * to silently re-break the conversion funnel at step 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: false, user: null }),
}))

vi.mock('../components/shared/GlobalNavBar', () => ({
  default: () => null,
}))

vi.mock('../components/Footer', () => ({
  default: () => null,
}))

import App from '../App'

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })),
  )
})

function renderAnonymousRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('books compliance public GTM surfaces render anonymously', () => {
  it('renders the landing page content without bouncing to ID login', () => {
    renderAnonymousRoute('/books/compliance')
    expect(
      screen.getByText(/See compliance readiness/i),
    ).toBeInTheDocument()
    // Honest non-PII intake state: the CTA stays, the gate does not appear.
    expect(screen.getByText(/View validation pricing/i)).toBeInTheDocument()
    expect(window.location.href).not.toContain('/id/login')
  })

  it('renders the pricing page content without bouncing to ID login', () => {
    renderAnonymousRoute('/books/compliance/pricing')
    expect(
      screen.getByText(/not another filing promise/i),
    ).toBeInTheDocument()
    expect(window.location.href).not.toContain('/id/login')
  })
})
