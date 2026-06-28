import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

// VEN-39 (VEN-37): Shizuha Developer API public landing + pricing page (shizuha.com/api).
// Platform-first positioning — an OpenAI-compatible LLM API *and* Shizuha workflow/agent
// tooling, not just cheap inference. "Get API key" posts to the Cortex public-API signup
// endpoint (POST /api/cortex/signup, from shizuha-labs/forge#18) and shows + copies the key.

// VEN-46: the public model id MUST be a live Cortex model (GET /api/cortex/v1/models).
// `qwen3-8b` was never deployed, so a copied snippet 400'd ("Model qwen3-8b is not
// available"). Use a current live id; re-verify against /v1/models if it changes.
const CODE_SNIPPET = `curl https://shizuha.com/api/cortex/v1/chat/completions \\
  -H "Authorization: Bearer $SHIZUHA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen3.6-27B-BF16",
    "messages": [{"role": "user", "content": "Hello from Shizuha"}]
  }'`

function campaignSource() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('utm_source') || params.get('source') || ''
}

function trackApi(eventType, extra = {}) {
  if (typeof navigator === 'undefined') return
  const payload = JSON.stringify({
    event_type: eventType,
    surface: 'cortex-api',
    path: `${window.location.pathname}${window.location.search}`,
    source: campaignSource(),
    ...extra,
  })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/cortex/event', new Blob([payload], { type: 'application/json' }))
      return
    }
    fetch('/api/cortex/event', {
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

function ApiKeyResult({ apiKey, freeNote }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be blocked; the key is still visible to copy manually.
    }
  }
  return (
    <div className="rounded-2xl border border-brand-600 bg-brand-50/50 dark:bg-brand-900/10 dark:border-brand-500 p-6 text-left">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Your API key</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {freeNote} Keep it secret — pass it as the <code>Authorization: Bearer</code> header.
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <div className="flex-1 min-w-0">
          <CodeBlock>{apiKey}</CodeBlock>
        </div>
        <button
          type="button" onClick={copy}
          className="shrink-0 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3 transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">Try it now</p>
      <CodeBlock>{CODE_SNIPPET.replace('$SHIZUHA_API_KEY', apiKey)}</CodeBlock>
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
    trackApi('form_start', { path: '/api#signup' })
  }

  async function onSubmit(e) {
    e.preventDefault()
    trackApi('order_intent', { path: '/api#signup' })
    setState({ status: 'loading' })
    try {
      const r = await fetch('/api/cortex/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, source: campaignSource() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || 'Signup failed. Please try again.')
      setState({ status: 'done', apiKey: data.api_key, free: data.free_tokens_per_day })
    } catch (err) {
      setState({ status: 'error', message: String(err.message || err) })
    }
  }

  if (state.status === 'done') {
    const freeNote = state.free
      ? `${Number(state.free).toLocaleString()} free tokens/day on the free tier.`
      : '100,000 free tokens/day on the free tier.'
    return <ApiKeyResult apiKey={state.apiKey} freeNote={freeNote} />
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
      <p className="text-xs text-gray-400 dark:text-gray-500">Free tier: 100k tokens/day. No card required.</p>
    </form>
  )
}

const FEATURES = [
  ['OpenAI-compatible', 'Point any OpenAI SDK at the Shizuha base URL — drop-in chat/completions, streaming, tools.'],
  ['Platform, not just inference', 'The same key unlocks Shizuha workflow + agent tooling (Pulse, Drive, Wiki, agents) — build apps, not just prompts.'],
  ['Indian-rupee pricing', 'Transparent ₹ plans with a generous free tier; pay only when you grow.'],
]

export default function ApiPage() {
  useEffect(() => {
    trackApi('page_view')
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              The Shizuha Developer API
            </h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
              An <strong>OpenAI-compatible</strong> LLM API <em>and</em> the Shizuha agent/workflow
              platform — one key, <strong>100k free tokens/day</strong> to start.
            </p>
            <div className="mt-8">
              <CodeBlock>{CODE_SNIPPET}</CodeBlock>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-4">
          <div className="max-w-4xl mx-auto grid sm:grid-cols-3 gap-6">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 text-left">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6">
            <PricingCard
              name="Free" price="₹0" sub="forever"
              features={['100,000 tokens / day', 'OpenAI-compatible API', 'API key on signup', 'No card required']}
            />
            <PricingCard
              name="Starter" price="₹499" sub="per month" highlight
              features={['10M tokens / month', 'Everything in Free', 'Higher rate limits', 'Workflow + agent tooling']}
            />
            <PricingCard
              name="Pro" price="₹999" sub="per month"
              features={['30M tokens / month', 'Everything in Starter', 'Priority throughput', 'Early access to new models']}
            />
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div id="signup" className="max-w-md mx-auto">
            <SignupForm />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
