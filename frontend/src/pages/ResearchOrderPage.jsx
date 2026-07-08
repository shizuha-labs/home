import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Clock, FileSearch, Shield } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const DISCLAIMER_VERSION = 'v2026-07-04'
const DPDP_NOTICE_VERSION = 'v2026-07-05'
const PRIVACY_EMAIL = 'privacy@shizuha.com'

const GUARANTEES = [
  { icon: Clock, text: 'Intent reviewed within 2 hours' },
  { icon: FileSearch, text: 'Scope confirmed before any invoice or audit work' },
  { icon: Shield, text: 'Evidence-first — no ranking or citation guarantees' },
]

const OFFER_TIERS = [
  {
    value: 'sample',
    label: 'Free sample link',
    price: '₹0',
    description: 'See the example format before you request a paid audit.',
  },
  {
    value: 'audit',
    label: 'AI-search / GEO audit',
    price: '₹1,499',
    description: 'Fixed-scope 24–48h visibility audit after scope confirmation.',
  },
  {
    value: 'audit_plus_recheck',
    label: 'Audit + recheck',
    price: '₹2,499',
    description: 'Audit plus one follow-up recheck after you make changes.',
  },
]

function tierFromQuery() {
  if (typeof window === 'undefined') return 'audit'
  const offer = new URLSearchParams(window.location.search).get('offer')
  if (offer === 'sample') return 'sample'
  if (offer === 'audit_plus_recheck' || offer === 'audit-recheck') return 'audit_plus_recheck'
  return 'audit'
}

export default function ResearchOrderPage() {
  const initialTier = useMemo(() => tierFromQuery(), [])
  const [form, setForm] = useState({
    site_url: '',
    contact_name: '',
    contact_email: '',
    offer_tier: initialTier,
    company_website: '',
  })
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmation, setConfirmation] = useState(null)

  const selectedTier = useMemo(
    () => OFFER_TIERS.find((tier) => tier.value === form.offer_tier) || OFFER_TIERS[1],
    [form.offer_tier],
  )

  useEffect(() => {
    setPageMeta({
      title: 'Request an AI-Search / GEO Audit — Shizuha',
      description: 'Submit intent for a fixed-scope AI-search/GEO audit. No payment is collected on this page and outcomes are not guaranteed.',
    })
    trackResearchEvent('research_order_view', { offer_tier: initialTier, route: '/research/order' })
  }, [initialTier])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    if (name === 'offer_tier') {
      trackResearchEvent('research_offer_select', { offer_tier: value })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.site_url || !form.contact_name || !form.contact_email) return
    trackResearchEvent('research_order_submit', { offer_tier: form.offer_tier })

    setStatus('submitting')
    setErrorMsg('')
    setConfirmation(null)

    try {
      const res = await fetch('/api/research/audit-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_url: form.site_url.trim(),
          contact_name: form.contact_name.trim(),
          contact_email: form.contact_email.trim().toLowerCase(),
          offer_tier: form.offer_tier,
          price_shown: selectedTier.price,
          intent: 'requested',
          disclaimer_version: DISCLAIMER_VERSION,
          dpdp_notice_version: DPDP_NOTICE_VERSION,
          company_website: form.company_website,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        setConfirmation(data)
        setStatus('success')
        trackResearchEvent('research_order_success', {
          offer_tier: data.offer_tier,
          lead_id: data.lead_id,
        })
      } else {
        const msg = data?.detail || 'Something went wrong. Please check the form and try again.'
        setErrorMsg(Array.isArray(msg) ? msg.map((item) => item.msg || item).join('; ') : msg)
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />

      <main className="flex-1 pt-16">
        <section className="px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-2xl mx-auto">
            {status === 'success' ? (
              <div className="text-center py-16">
                <CheckCircle className="w-16 h-16 text-violet-500 mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Audit intent received</h1>
                <p className="text-gray-500 dark:text-gray-400 text-lg mb-2">
                  This is not a purchase: no payment was collected and no live-site audit has started.
                </p>
                <p className="text-gray-500 dark:text-gray-400 mb-2">
                  Lead ID {confirmation?.lead_id}. We will contact you to confirm scope before any invoice, crawl, fetch, analysis, or fulfilment work begins.
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Server-confirmed tier: {confirmation?.offer_tier} ({confirmation?.price_shown}). Disclaimer {confirmation?.disclaimer_version}.
                </p>
                <a
                  href="/research"
                  className="mt-8 inline-block text-sm text-violet-600 dark:text-violet-400 hover:underline"
                >
                  ← Back to AI-search audit overview
                </a>
              </div>
            ) : (
              <>
                <div className="mb-10">
                  <a
                    href="/research"
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 inline-block"
                  >
                    ← Back to Research
                  </a>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-sm font-medium mb-4 border border-violet-200 dark:border-violet-800">
                    <span className="text-lg font-bold">{selectedTier.price}</span>
                    <span>{selectedTier.label}</span>
                  </div>
                  <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                    Request an AI-Search / GEO Audit
                  </h1>
                  <p className="text-gray-500 dark:text-gray-400 text-lg">
                    Submit paid intent for the fixed-scope GEO audit. We collect only contact details, the site URL you provide, and your selected tier so Shizuha can follow up. No payment is collected here, we do not fetch the live site before scope confirmation, and we do not guarantee rankings, citations, AI answer inclusion, SEO/GEO outcomes, or placement.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 mt-6">
                    {GUARANTEES.map(({ icon: Icon, text }) => (
                      <div key={text} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Icon className="w-4 h-4 text-violet-500 flex-shrink-0" />
                        {text}
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="offer_tier" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Audit tier
                    </label>
                    <select
                      id="offer_tier"
                      name="offer_tier"
                      value={form.offer_tier}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    >
                      {OFFER_TIERS.map((offer) => (
                        <option key={offer.value} value={offer.value}>{offer.label} — {offer.price}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-400">{selectedTier.description}</p>
                  </div>

                  <div>
                    <label htmlFor="site_url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Site URL to audit later
                    </label>
                    <input
                      id="site_url"
                      name="site_url"
                      type="url"
                      required
                      value={form.site_url}
                      onChange={handleChange}
                      placeholder="https://example.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                    <p className="mt-1 text-xs text-gray-400">We store this URL for follow-up only; the page does not fetch or audit it before you confirm scope.</p>
                  </div>

                  <div>
                    <label htmlFor="contact_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Contact name
                    </label>
                    <input
                      id="contact_name"
                      name="contact_name"
                      type="text"
                      required
                      value={form.contact_name}
                      onChange={handleChange}
                      placeholder="Alex Chen"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label htmlFor="contact_email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Contact email
                    </label>
                    <input
                      id="contact_email"
                      name="contact_email"
                      type="email"
                      required
                      value={form.contact_email}
                      onChange={handleChange}
                      placeholder="alex@example.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                  </div>

                  <div className="hidden" aria-hidden="true">
                    <label htmlFor="company_website">Company website</label>
                    <input
                      id="company_website"
                      name="company_website"
                      type="text"
                      tabIndex="-1"
                      autoComplete="off"
                      value={form.company_website}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/40 p-4 text-sm text-gray-700 dark:text-gray-300 space-y-2">
                    <p className="font-semibold text-gray-900 dark:text-white">DPDP notice at collection — {DPDP_NOTICE_VERSION}</p>
                    <p>
                      Controller: Shizuha Global Pvt. Ltd. We collect your contact name, contact email, selected offer tier, and the site URL solely to follow up about this AI-search/GEO audit intent and deletion requests.
                    </p>
                    <p>
                      Retention: audit lead intents are kept for up to 45 days unless converted into a separate customer engagement or deleted sooner. To request deletion, email {PRIVACY_EMAIL} with the contact email used here.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-4 text-sm text-amber-900 dark:text-amber-200 space-y-2">
                    <p className="font-semibold">Guardrail disclaimer — {DISCLAIMER_VERSION}</p>
                    <p>
                      This form records intent only. No card details or payment provider are used. Shizuha will not fetch your live site, start fulfilment, or issue an invoice until scope is confirmed. AI-search visibility, rankings, citations, answer inclusion, SEO/GEO outcomes, and placement are not guaranteed.
                    </p>
                  </div>

                  {status === 'error' && (
                    <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-lg transition-colors shadow-md shadow-violet-500/20"
                  >
                    {status === 'submitting' ? 'Submitting…' : 'Submit audit intent — no payment now'}
                  </button>

                  <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                    By submitting, you acknowledge disclaimer {DISCLAIMER_VERSION}; this is not a purchase and no audit starts until scope is confirmed.
                  </p>
                </form>
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
