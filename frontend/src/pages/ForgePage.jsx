import { useEffect, useRef, useState } from 'react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { trackPlausibleEvent } from '../utils/analytics'

// VEN-7: Shizuha Forge public API landing + pricing page (shizuha.com/forge).
// "Get API key" posts to the public-api signup endpoint and shows the issued key.

const CODE_SNIPPET = `curl -X POST https://shizuha.com/api/forge/generate \\
  -H "X-API-Key: $FORGE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "a red fox in snow, golden hour, photorealistic"}'`

// FRG-24 (VEN-62 §4.1): scriptable examples are the product — curl + Python + JS,
// same request shape (POST /api/forge/generate, X-API-Key header, {prompt}).
const PYTHON_SNIPPET = `import requests

resp = requests.post(
    "https://shizuha.com/api/forge/generate",
    headers={"X-API-Key": "YOUR_FORGE_KEY"},
    json={"prompt": "a red fox in snow, golden hour, photorealistic"},
    timeout=120,
)
resp.raise_for_status()          # 401 bad key · 422 bad body · 429 daily limit
print(resp.json())               # -> generated image payload`

const JS_SNIPPET = `const resp = await fetch("https://shizuha.com/api/forge/generate", {
  method: "POST",
  headers: {
    "X-API-Key": "YOUR_FORGE_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt: "a red fox in snow, golden hour, photorealistic" }),
})
if (!resp.ok) throw new Error(\`Forge error \${resp.status}\`)  // 401/422/429/5xx
console.log(await resp.json())   // -> generated image payload`

// Live-verified error bodies (2026-07-03) so the docs match the real API.
const ERROR_429_SNIPPET = `HTTP/1.1 429 Too Many Requests
Retry-After: <seconds until your daily window resets>

{"detail": "Daily free limit reached (10/day). Retry after the reset, or switch to pay-as-you-go ($0.02/image)."}`

// Ranked value props (VEN-62 RFC §3).
const VALUE_PROPS = [
  ['One REST call, no GPU', 'Generate images from a single HTTP request — no GPU to provision, no model to host.'],
  ['Predictable price', '10 images/day free, then a flat $0.02/image. No opaque credit math.'],
  ['Scriptable examples', 'curl, Python, and JavaScript snippets are the product — copy, paste, ship. No SDK required.'],
  ['Self-hosted India infra', 'Runs on Shizuha’s own India-based GPU infra — a trust and margin story, not a compliance claim.'],
  ['Part of the Shizuha Developer API', 'One key today; bundle with Cortex/agent workflow APIs as your usage grows.'],
]

const USE_CASES = [
  'Product mockups & placeholder art for prototypes',
  'Social thumbnails and marketing assets at scale',
  'Workflow-generated images in automations and agents',
  'On-demand illustrations for apps without a design pipeline',
]

// Live-confirmed shapes: 422 = FastAPI validation array; 401 = {"detail": "..."}.
const TROUBLESHOOTING = [
  ['401', 'Missing / invalid key', '{"detail": "Missing API key. Send it in the X-API-Key header. Get one at shizuha.com/forge."}'],
  ['401', 'Revoked key', '{"detail": "Invalid or revoked API key."}'],
  ['422', 'Missing / bad prompt', '{"detail": [{"type": "missing", "loc": ["body", "prompt"], "msg": "Field required"}]}'],
  ['429', 'Daily free limit reached', '{"detail": "Daily free limit reached (10/day)."} + Retry-After header'],
  ['5xx', 'Transient backend error', '{"detail": "..."} — retry with exponential backoff (see below)'],
]

function campaignSource() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('utm_source') || params.get('source') || ''
}

function forgePlausibleProps(extra = {}) {
  return {
    product: 'forge-api',
    surface: 'forge',
    source: campaignSource(),
    ...extra,
  }
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
  const plausibleEvent = {
    signup: 'signup',
    api_key_generated: 'api_key_generated',
  }[eventType]
  if (plausibleEvent) {
    trackPlausibleEvent(plausibleEvent, forgePlausibleProps(extra))
  }
  const firstPartyEventType = {
    signup: 'signup_submit',
    api_key_generated: 'key_generated',
  }[eventType] || eventType
  if (typeof navigator === 'undefined') return
  const payload = JSON.stringify({
    event_type: firstPartyEventType,
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

// FRG-24: code block with a copy button. Emits the optional (VEN-62 §4.2)
// `example_copy` funnel event through the existing trackForge path — no new
// analytics system, no new endpoint.
function CopyableCode({ label, children }) {
  const [copied, setCopied] = useState(false)
  function onCopy() {
    try {
      navigator.clipboard?.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — the snippet is still selectable inline.
    }
    trackForge('example_copy', { example: label })
  }
  return (
    <div className="relative">
      {label && (
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      )}
      <button
        type="button" onClick={onCopy}
        className="absolute right-2 top-7 z-10 rounded-md bg-gray-800/80 hover:bg-gray-700 text-gray-100 text-xs px-2 py-1 border border-gray-700"
        aria-label={`Copy ${label} example`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <CodeBlock>{children}</CodeBlock>
    </div>
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
    trackForge('signup', { path: '/forge/signup' })
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
      trackForge('api_key_generated', { path: '/forge/signup', tier: data.tier || 'free' })
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
  const pageviewSent = useRef(false)

  useEffect(() => {
    if (pageviewSent.current) return
    pageviewSent.current = true
    trackForgeLandingView()
    trackForge('page_view')
    trackForge('quickstart_view')
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <GlobalNavBar />
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
              <CopyableCode label="curl — generate your first image">{CODE_SNIPPET}</CopyableCode>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Get a key below, drop it in <code>X-API-Key</code>, and you have a first image in under 5 minutes.
            </p>
          </div>
        </section>

        {/* Value props (RFC §3) */}
        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {VALUE_PROPS.map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 text-left">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Quickstart: language examples (RFC §4.1) */}
        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-3xl mx-auto text-left">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Quickstart</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Same request in every language: <code>POST /api/forge/generate</code> with your
              <code> X-API-Key</code> header and a <code>prompt</code>.
            </p>
            <div className="mt-5 space-y-5">
              <CopyableCode label="Python (requests)">{PYTHON_SNIPPET}</CopyableCode>
              <CopyableCode label="JavaScript / Node (fetch)">{JS_SNIPPET}</CopyableCode>
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

        {/* Limits, errors & troubleshooting (RFC §4.1 #4/#6) */}
        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-3xl mx-auto text-left">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Limits & errors</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Free tier is <strong>10 images/day</strong>; then <strong>$0.02/image</strong>. When you hit the
              daily cap the API returns <code>429</code> with a <code>Retry-After</code> header — back off and retry:
            </p>
            <div className="mt-4">
              <CopyableCode label="429 — daily limit reached">{ERROR_429_SNIPPET}</CopyableCode>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
              Recommended backoff: retry <code>429</code>/<code>5xx</code> with exponential backoff
              (e.g. 1s, 2s, 4s, 8s, capped) and jitter; never retry <code>401</code>/<code>422</code> — fix the key or body.
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm border border-gray-200 dark:border-gray-800 rounded-lg">
                <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Cause</th>
                    <th className="px-3 py-2 font-medium">Response body</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700 dark:text-gray-300">
                  {TROUBLESHOOTING.map(([code, cause, body]) => (
                    <tr key={code + cause} className="border-t border-gray-200 dark:border-gray-800 align-top">
                      <td className="px-3 py-2 font-mono">{code}</td>
                      <td className="px-3 py-2">{cause}</td>
                      <td className="px-3 py-2 font-mono text-xs break-all">{body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Stuck? Email <a className="text-brand-600 dark:text-brand-400 underline" href="mailto:forge@shizuha.com">forge@shizuha.com</a> with the request timestamp and status code (never your API key).
            </p>
          </div>
        </section>

        {/* Use cases (RFC §4.1 #5) */}
        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-3xl mx-auto text-left">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">What people build</h2>
            <ul className="mt-4 grid sm:grid-cols-2 gap-3 text-sm text-gray-600 dark:text-gray-300">
              {USE_CASES.map((u) => (
                <li key={u} className="flex items-start gap-2">
                  <span className="text-brand-600 dark:text-brand-400">✓</span>{u}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="signup" className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-md mx-auto">
            <SignupForm />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
