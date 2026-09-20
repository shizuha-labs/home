import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

// PLAT-9402 Slice B — the unified per-account usage dashboard (shizuha.com).
// Fed exclusively by the Metering Core's neutral aggregate plane via the home
// BFF proxy (/api/usage/summary → hive /api/v1/usage/summary): the account is
// derived server-side from the Shizuha-ID subject, so this page can only ever
// render the caller's own usage (two-account isolation is structural at the
// core boundary — HLD §2/§2.1). Quantities arrive as decimal strings and are
// rendered verbatim — no float math client-side. Consumption is eventually
// consistent: the usage_watermark is rendered as the "as of" timestamp and
// never presented as live.

const SERVICE_BY_METER_PREFIX = [
  ['inference.', 'Cortex'],
  ['agent.', 'Hive'],
  ['runtime.', 'Hive'],
  ['compute.', 'SCS'],
  ['storage.', 'Drive'],
  ['requests.', 'Edge'],
  ['network.', 'Edge'],
]

function serviceForMeter(meterKey) {
  const hit = SERVICE_BY_METER_PREFIX.find(([prefix]) => (meterKey || '').startsWith(prefix))
  return hit ? hit[1] : 'Other'
}

function fmtQuantity(decimalString) {
  // Render the core's decimal string verbatim; trim trailing zeros for
  // display only (the underlying value is never parsed as a float).
  const s = String(decimalString ?? '0')
  if (!s.includes('.')) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

function fmtAsOf(isoString) {
  if (!isoString) return 'no usage recorded yet'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return isoString
  return d.toLocaleString()
}

function MeterBar({ label, consumed, granted, unit }) {
  const consumedNum = Number(consumed ?? 0)
  const grantedNum = Number(granted ?? 0)
  const pct = grantedNum > 0 ? Math.min(100, Math.round((consumedNum / grantedNum) * 100)) : 0
  const over = grantedNum > 0 && consumedNum > grantedNum
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
        <div className={`text-sm ${over ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {fmtQuantity(consumed)} / {fmtQuantity(granted)} {unit}
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{pct}% of plan allowance</div>
    </div>
  )
}

function ServiceMeterCard({ service, rollups }) {
  const total = rollups.reduce((acc, r) => acc + Number(r.gross_quantity ?? 0), 0)
  const units = [...new Set(rollups.map((r) => r.unit))].join(', ')
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{service}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {fmtQuantity(String(total))}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{units}</div>
      <div className="mt-3 space-y-1">
        {rollups.map((r, i) => (
          <div key={i} className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{r.meter_key}</span>
            <span>
              {fmtQuantity(r.gross_quantity)} {r.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function UsagePage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/usage/summary', { credentials: 'include' })
      // Guard the content type: a routing regression (the path falling through
      // to the SPA history fallback) yields 200 text/html — parsing that as
      // JSON would surface a raw SyntaxError instead of a usable message.
      const ctype = res.headers.get('content-type') || ''
      if (!res.ok || !ctype.includes('application/json')) {
        const detail = res.status === 401
          ? 'Your session has expired — sign in again to view usage.'
          : 'The usage service is temporarily unavailable. Try again shortly.'
        throw new Error(detail)
      }
      setData(await res.json())
    } catch (exc) {
      setError(exc.message || 'Failed to load usage.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const rollups = data?.usage?.rollups ?? []
  const entitlements = data?.entitlements?.entitlements ?? []

  const byService = rollups.reduce((acc, r) => {
    const service = serviceForMeter(r.meter_key)
    acc[service] = acc[service] || []
    acc[service].push(r)
    return acc
  }, {})

  // Allowances-vs-consumption: match each entitlement to the rollups of its
  // meter key. Entitlements whose meter has no rollups still render (0 used).
  const meterTotals = rollups.reduce((acc, r) => {
    acc[r.meter_key] = (acc[r.meter_key] ?? 0) + Number(r.gross_quantity ?? 0)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <GlobalNavBar />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Usage</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Per-account consumption across Shizuha services
              {data?.account?.display_name ? ` — ${data.account.display_name}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          As of {fmtAsOf(data?.usage?.usage_watermark)} — usage is eventually consistent; late
          events roll up automatically.
        </div>

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading && !data && (
          <div className="mt-10 text-sm text-gray-500 dark:text-gray-400">Loading usage…</div>
        )}

        {data && (
          <>
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Current usage by service
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Object.keys(byService).length === 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                    No usage recorded for this account yet.
                  </div>
                )}
                {Object.entries(byService).map(([service, serviceRollups]) => (
                  <ServiceMeterCard key={service} service={service} rollups={serviceRollups} />
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Plan allowances vs consumption
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {entitlements.length === 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                    No plan allowances on this account yet.
                  </div>
                )}
                {entitlements.map((e, i) => (
                  <MeterBar
                    key={i}
                    label={e.meter_key || e.grant_key}
                    consumed={meterTotals[e.meter_key] ?? e.consumed_amount}
                    granted={e.granted_amount}
                    unit={e.meter_key ? '' : ''}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
