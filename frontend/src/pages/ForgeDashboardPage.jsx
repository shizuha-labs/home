import { useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2, WalletCards } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

const STORAGE_KEY = 'shizuha_forge_api_key'

function fmtMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

function StatCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {helper && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helper}</div>}
    </div>
  )
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value || '')
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      <Copy className="h-4 w-4" /> {copied ? 'Copied' : label}
    </button>
  )
}

async function forgeFetch(path, apiKey, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Forge API error (${res.status})`)
  return data
}

export default function ForgeDashboardPage() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '')
  const [draftKey, setDraftKey] = useState(apiKey)
  const [dashboard, setDashboard] = useState(null)
  const [newKey, setNewKey] = useState('')
  const [status, setStatus] = useState(apiKey ? 'loading' : 'idle')
  const [error, setError] = useState('')

  const recentMax = useMemo(() => {
    const rows = dashboard?.usage?.recent_daily || []
    return Math.max(1, ...rows.map((row) => row.images + row.errors))
  }, [dashboard])

  async function load(key = apiKey) {
    if (!key.trim()) return
    setStatus('loading')
    setError('')
    setNewKey('')
    try {
      const data = await forgeFetch('/api/forge/dashboard', key.trim())
      setDashboard(data)
      setApiKey(key.trim())
      setDraftKey(key.trim())
      localStorage.setItem(STORAGE_KEY, key.trim())
      setStatus('ready')
    } catch (err) {
      setDashboard(null)
      setError(err.message || 'Could not load dashboard.')
      setStatus('error')
    }
  }

  useEffect(() => {
    if (apiKey) load(apiKey)
    // Run once on mount for a saved API key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function regenerate() {
    if (!apiKey || !window.confirm('Regenerate this API key? The current key will stop working immediately.')) return
    setStatus('loading')
    setError('')
    try {
      const data = await forgeFetch('/api/forge/key/regenerate', apiKey, { method: 'POST' })
      setNewKey(data.api_key)
      setDashboard(data.dashboard)
      setApiKey(data.api_key)
      setDraftKey(data.api_key)
      localStorage.setItem(STORAGE_KEY, data.api_key)
      setStatus('ready')
    } catch (err) {
      setError(err.message || 'Could not regenerate key.')
      setStatus('error')
    }
  }

  async function revoke() {
    if (!apiKey || !window.confirm('Revoke this API key? You will need to sign up or use another key afterwards.')) return
    setStatus('loading')
    setError('')
    try {
      await forgeFetch('/api/forge/key/revoke', apiKey, { method: 'POST' })
      localStorage.removeItem(STORAGE_KEY)
      setApiKey('')
      setDraftKey('')
      setDashboard(null)
      setNewKey('')
      setStatus('idle')
    } catch (err) {
      setError(err.message || 'Could not revoke key.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <GlobalNavBar />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-900/20 dark:text-brand-300 dark:ring-brand-800">
              <KeyRound className="h-4 w-4" /> Forge API dashboard
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">Manage your Forge API key and usage.</h1>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-300">
              Paste your Forge API key to view quota, billing status, and key lifecycle controls. The key is sent only as the <code>X-API-Key</code> header to Forge.
            </p>
          </div>
          <a href="/forge" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">Back to Forge pricing →</a>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <form
            className="grid gap-3 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              load(draftKey)
            }}
          >
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="sk-forge-..."
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm outline-none ring-brand-500/20 focus:ring-4 dark:border-gray-700 dark:bg-gray-950"
            />
            <button
              type="submit"
              disabled={status === 'loading' || !draftKey.trim()}
              className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'loading' ? 'Loading…' : 'Load dashboard'}
            </button>
            {apiKey && <CopyButton value={apiKey} label="Copy key" />}
          </form>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {newKey && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="font-semibold text-amber-900 dark:text-amber-100">New API key — copy it now</div>
              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
                <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-sm dark:bg-gray-950">{newKey}</code>
                <CopyButton value={newKey} label="Copy new key" />
              </div>
            </div>
          )}
        </section>

        {dashboard && (
          <div className="mt-6 space-y-6">
            <section className="grid gap-4 md:grid-cols-4">
              <StatCard label="Images today" value={dashboard.usage.images_today} helper={`${dashboard.usage.remaining_free_today ?? '∞'} remaining today`} />
              <StatCard label="Images total" value={dashboard.usage.images_total} helper="Successful generations" />
              <StatCard label="Free tier" value={`${dashboard.usage.free_daily_limit}/day`} helper={dashboard.account.tier === 'free' ? 'Current plan' : 'Pay-as-you-go plan'} />
              <StatCard label="Current overage" value={fmtMoney(dashboard.billing.current_overage_usd)} helper={`${dashboard.billing.current_overage_images} billable images`} />
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Usage history</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Recent daily successful images and errors.</p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-brand-500" />
                </div>
                <div className="mt-5 space-y-3">
                  {(dashboard.usage.recent_daily || []).length === 0 ? (
                    <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">No generations recorded for this key yet.</p>
                  ) : dashboard.usage.recent_daily.map((row) => (
                    <div key={row.date} className="grid grid-cols-[96px_1fr_80px] items-center gap-3 text-sm">
                      <div className="font-mono text-xs text-gray-500">{row.date}</div>
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, ((row.images + row.errors) / recentMax) * 100)}%` }} />
                      </div>
                      <div className="text-right text-gray-600 dark:text-gray-300">{row.images} ok · {row.errors} err</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="text-lg font-semibold">API key</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">Key</dt><dd className="font-mono">{dashboard.api_key.masked}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">State</dt><dd>{dashboard.api_key.is_active ? 'Active' : 'Revoked'}</dd></div>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={regenerate} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200">
                      <RefreshCw className="h-4 w-4" /> Regenerate
                    </button>
                    <button type="button" onClick={revoke} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">
                      <Trash2 className="h-4 w-4" /> Revoke
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><WalletCards className="h-5 w-5" /> Billing</h2>
                  <div className="mt-4 space-y-3">
                    {dashboard.billing.invoices.map((invoice) => (
                      <div key={`${invoice.period}-${invoice.status}`} className="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
                        <div className="flex justify-between"><span className="font-medium">{invoice.period}</span><span>{invoice.status}</span></div>
                        <div className="mt-1 text-gray-500 dark:text-gray-400">{invoice.images} images · {fmtMoney(invoice.amount_usd)} · {invoice.payment_status}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="text-lg font-semibold">Account settings</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">Email</dt><dd>{dashboard.account.email}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">Plan</dt><dd>{dashboard.account.tier}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">Name</dt><dd>{dashboard.account.name || '—'}</dd></div>
                  </dl>
                  <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">{dashboard.account.password_reset.message}</p>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
