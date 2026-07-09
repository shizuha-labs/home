import { useState, useRef } from 'react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

// VEN-146: standalone /forge/signup page — email capture → API key via email.

function campaignSource() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('utm_source') || params.get('source') || ''
}

function CodeBlock({ children }) {
  return (
    <pre className="text-left text-xs sm:text-sm bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto border border-gray-800">
      <code>{children}</code>
    </pre>
  )
}

export default function ForgeSignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  const formStarted = useRef(false)

  function markFormStart() {
    if (formStarted.current) return
    formStarted.current = true
  }

  async function onSubmit(e) {
    e.preventDefault()
    setState({ status: 'loading' })
    try {
      const r = await fetch('/api/forge/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, source: campaignSource() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || 'Signup failed. Please try again.')
      setState({ status: 'done', email })
    } catch (err) {
      setState({ status: 'error', message: String(err.message || err) })
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <GlobalNavBar />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Get your Forge API key
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Free tier: <strong>10 images/day</strong>. No credit card required.
            </p>
          </div>

          {state.status === 'done' ? (
            <div className="rounded-2xl border border-brand-600 bg-brand-50/50 dark:bg-brand-900/10 dark:border-brand-500 p-6 text-left space-y-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-sm font-bold">✓</span>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Check your email</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                We sent your API key to <strong>{state.email}</strong>. Keep it secret — pass it as the <code className="text-xs">X-API-Key</code> header in every request.
              </p>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Quick start</p>
                <CodeBlock>{`curl -X POST https://shizuha.com/api/forge/generate \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "a red fox in snow, golden hour, photorealistic"}'`}</CodeBlock>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                <a href="/forge" className="text-brand-600 dark:text-brand-400 underline">Full docs →</a>
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-left space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  id="name" type="text" placeholder="Your name" value={name}
                  onChange={(e) => { markFormStart(); setName(e.target.value) }}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="email" type="email" required placeholder="you@example.com" value={email}
                  onChange={(e) => { markFormStart(); setEmail(e.target.value) }}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit" disabled={state.status === 'loading'}
                className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 transition-colors"
              >
                {state.status === 'loading' ? 'Generating key…' : 'Get API key'}
              </button>
              {state.status === 'error' && (
                <p className="text-sm text-red-500">{state.message}</p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                Already have a key? <a href="/forge" className="text-brand-600 dark:text-brand-400 underline">View docs</a>
              </p>
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
