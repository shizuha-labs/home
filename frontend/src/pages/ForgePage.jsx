import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

// VEN-7: Shizuha Forge public API landing + pricing page (shizuha.com/forge).
// "Get API key" posts to the public-api signup endpoint and shows the issued key.

const CODE_SNIPPET = `curl -X POST https://shizuha.com/api/forge/generate \\
  -H "X-API-Key: $FORGE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "a red fox in snow, golden hour, photorealistic"}'`

function campaignSource() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('utm_source') || params.get('source') || ''
}

let forgeLandingViewSent = false

function trackForgeLandingView() {
  if (typeof window === 'undefined' || typeof fetch === 'undefined' || forgeLandingViewSent) return
  forgeLandingViewSent = true
  try {
    fetch('/api/forge/landing', {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Best-effort funnel beacon only; never block the landing page.
  }
}

function trackForge(eventType, extra = {}) {
  if (typeof navigator === 'undefined') return
  const payload = JSON.stringify({
    event_type: eventType,
    surface: 'forge',
    path: `${window.location.pathname}${window.location.search}`,
    source: campaignSource(),
    ...extra,
  })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/forge/event', new Blob([payload], { type: 'application/json' }))
      return
    }
    fetch('/api/forge/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
  } catch {
    // Best-effort first-party telemetry only; never block the funnel.
  }
}

function CodeBlock({ children }) {
  return (
    <pre className="text-left text-xs sm:text-sm bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto border border-gray-800">
      <code>{children}</code>
    </pre>
  )
}

function PricingCard({ name, price, sub, features, highlight }) {
  return (
    <div className={`flex-1 rounded-2xl border p-6 ${highlight
      ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-900/10 dark:border-brand-500'
      : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'}`}>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{name}</h3>
      <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">{price}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{sub}</p>
      <ul className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="text-brand-600 dark:text-brand-400">✓</span>{f}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SignupForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | done | error
  const formStarted = useRef(false)

  function markFormStart() {
    if (formStarted.current) return
    formStarted.current = true
    trackForge('form_start', { path: '/forge#signup' })
  }

  async function onSubmit(e) {
    e.preventDefault()
    trackForge('order_intent', { path: '/forge#signup' })
    setState({ status: 'loading' })
    try {
      const r = await fetch('/api/forge/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, source: campaignSource() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || 'Signup failed. Please try again.')
      setState({ status: 'done', apiKey: data.api_key, free: data.free_per_day })
    } catch (err) {
      setState({ status: 'error', message: String(err.message || err) })
    }
  }

  if (state.status === 'done') {
    return (
      <div className="rounded-2xl border border-brand-600 bg-brand-50/50 dark:bg-brand-900/10 dark:border-brand-500 p-6 text-left">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Your API key</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {state.free} free generations/day. Keep it secret — pass it as the <code>X-API-Key</code> header.
        </p>
        <CodeBlock>{state.apiKey}</CodeBlock>
        <CodeBlock>{CODE_SNIPPET.replace('$FORGE_KEY', state.apiKey)}</CodeBlock>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-left space-y-3">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Get your API key</h3>
      <input
        type="text" placeholder="Name (optional)" value={name} onChange={(e) => { markFormStart(); setName(e.target.value) }}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
      />
      <input
        type="email" required placeholder="you@example.com" value={email} onChange={(e) => { markFormStart(); setEmail(e.target.value) }}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
      />
      <button
        type="submit" disabled={state.status === 'loading'}
        className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 transition-colors"
      >
        {state.status === 'loading' ? 'Generating key…' : 'Get API key'}
      </button>
      {state.status === 'error' && (
        <p className="text-sm text-red-500">{state.message}</p>
      )}
    </form>
  )
}

export default function ForgePage() {
  useEffect(() => {
    trackForgeLandingView()
    trackForge('page_view')
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Programmable AI image generation
            </h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
              One REST call to FLUX, no GPU to manage. <strong>$0.02/image</strong> after <strong>10 free/day</strong>.
            </p>
            <div className="mt-8">
              <CodeBlock>{CODE_SNIPPET}</CodeBlock>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
            <PricingCard
              name="Free" price="$0" sub="per month"
              features={['10 images / day', 'FLUX text-to-image', 'API key on signup', 'No card required']}
            />
            <PricingCard
              name="Pay-as-you-go" price="$0.02" sub="per image" highlight
              features={['Unlimited images', 'After your 10 free/day', 'Manual invoicing (early access)', 'Priority queue']}
            />
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-md mx-auto">
            <SignupForm />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
