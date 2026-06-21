import { useEffect, useState } from 'react'
import { CheckCircle, Clock, FileSearch, Shield } from 'lucide-react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const GUARANTEES = [
  { icon: Clock, text: 'Intent reviewed within 2 hours' },
  { icon: FileSearch, text: 'Audit/report scope confirmed before invoicing' },
  { icon: Shield, text: 'Evidence-first — no ranking or citation guarantees' },
]

const OFFER_TYPES = [
  { value: 'ai-search-audit', label: 'AI-search visibility audit (draft offer)' },
  { value: 'custom-research-report', label: 'Custom research report' },
  { value: 'other', label: 'Other research request' },
]

export default function ResearchOrderPage() {
  const initialOffer = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('offer') === 'ai-search-audit'
    ? 'ai-search-audit'
    : 'custom-research-report'
  const [form, setForm] = useState({ name: '', email: '', offerType: initialOffer, topic: '' })
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    setPageMeta({
      title: 'Request a Research or AI-Search Audit — Shizuha',
      description: 'Submit intent for a Shizuha research report or AI-search visibility audit. No payment is collected on this page and outcomes are not guaranteed.',
    })
    trackResearchEvent('research_order_view', { offer: form.offerType, route: '/research/order' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    if (name === 'offerType') {
      trackResearchEvent('research_offer_select', { offer: value })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.email || !form.topic) return
    trackResearchEvent('research_order_submit', { offer: form.offerType })

    setStatus('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/scs/api/research/order/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          topic: `Request type: ${OFFER_TYPES.find((offer) => offer.value === form.offerType)?.label || form.offerType}\n\n${form.topic.trim()}`,
        }),
      })

      if (res.status === 201) {
        setStatus('success')
      } else {
        const data = await res.json().catch(() => ({}))
        const msg =
          data?.topic?.[0] ||
          data?.email?.[0] ||
          data?.detail ||
          'Something went wrong. Please try again.'
        setErrorMsg(msg)
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <Navbar />

      <main className="flex-1 pt-16">
        <section className="px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-2xl mx-auto">
            {status === 'success' ? (
              <div className="text-center py-16">
                <CheckCircle className="w-16 h-16 text-violet-500 mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Order received!</h1>
                <p className="text-gray-500 dark:text-gray-400 text-lg mb-2">
                  We'll confirm your order and send an invoice within 2 hours.
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  Your report will be delivered within 24 hours of payment.
                </p>
                <a
                  href="/research"
                  className="mt-8 inline-block text-sm text-violet-600 dark:text-violet-400 hover:underline"
                >
                  ← Browse free sample reports
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
                    <span className="text-lg font-bold">$49</span>
                    <span>per report</span>
                  </div>
                  <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                    Request Research or an AI-Search Audit
                  </h1>
                  <p className="text-gray-500 dark:text-gray-400 text-lg">
                    Tell us what you want to learn. Choose the draft AI-search visibility audit to capture intent, or request a custom research report. No payment is collected here and we do not guarantee rankings, citations, AI answer inclusion, or SEO/GEO outcomes.
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
                    <label htmlFor="offerType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Request type
                    </label>
                    <select
                      id="offerType"
                      name="offerType"
                      value={form.offerType}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    >
                      {OFFER_TYPES.map((offer) => (
                        <option key={offer.value} value={offer.value}>{offer.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Your name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Alex Chen"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email address
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={handleChange}
                      placeholder="alex@example.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label htmlFor="topic" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Research question, company, or audit target
                    </label>
                    <textarea
                      id="topic"
                      name="topic"
                      required
                      rows={5}
                      value={form.topic}
                      onChange={handleChange}
                      placeholder="e.g. Audit how Acme Robotics appears in ChatGPT/Perplexity/Gemini answers for industrial robotics procurement, or compare vector databases for a production RAG system."
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-none"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Be as specific as possible — the more context you give, the better the report.
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
                    {status === 'submitting' ? 'Submitting…' : 'Submit intent — no payment now'}
                  </button>

                  <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                    No payment now. We'll confirm scope first; AI-search visibility and SEO/GEO outcomes are not guaranteed.
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
