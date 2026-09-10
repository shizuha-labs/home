/**
 * DOJO-87: the published legal pages must render the load-bearing clauses.
 * IT Rules 2021 safe harbour + DPDP posture depend on these being present.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TermsPage, PrivacyPage } from '../pages/LegalPage'

describe('DOJO-87 published legal pages', () => {
  it('Terms renders grievance officer, agent liability, and Dojo coaching clauses', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
    // IT Rules 2021 §15 grievance officer contact must be published.
    expect(screen.getByText(/grievance@shizuha.com/)).toBeInTheDocument()
    // HIVE-323 §5 agent-liability clause (customer is principal).
    expect(screen.getByText(/5\.1 Customer is principal/)).toBeInTheDocument()
    // Dojo feedback is coaching, not a hiring decision (§4.3).
    expect(screen.getByText(/Dojo feedback is coaching, not a hiring decision/)).toBeInTheDocument()
    // Cortex marketplace route disclosure (§10.3).
    expect(screen.getByText(/10\.3 Cortex marketplace\/community routes/)).toBeInTheDocument()
  })

  it('Privacy renders DPDP rights, India data location, and Dojo §9 principles', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument()
    // DPDP Act 2023 legal basis + data principal rights.
    expect(screen.getByText(/4\. Legal Basis \(DPDP Act 2023\)/)).toBeInTheDocument()
    expect(screen.getByText(/8\. Your Rights \(Data Principal Rights\)/)).toBeInTheDocument()
    // India data location commitment.
    expect(screen.getByText(/5\.1 Primary data location: India/)).toBeInTheDocument()
    // Dojo §7 charter principles: user-owned prep data, no recruiter exposure without consent.
    expect(screen.getByText(/9\.1 Your data is yours/)).toBeInTheDocument()
    expect(screen.getByText(/9\.2 No recruiter exposure without consent/)).toBeInTheDocument()
    // AI feedback labeled as coaching (§9.4).
    expect(screen.getByText(/9\.4 AI feedback is coaching/)).toBeInTheDocument()
  })
})
