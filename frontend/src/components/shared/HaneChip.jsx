import { useHaneBalance } from '../../hooks/useHaneBalance'

function Coin({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="home-hane-face" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#f5c14a" />
          <stop offset="100%" stopColor="#b8860b" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="#d4a017" />
      <circle cx="16" cy="16" r="12.5" fill="url(#home-hane-face)" />
    </svg>
  )
}

function formatHane(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function HaneChip() {
  const { data, observedAt, loading, stale, denied } = useHaneBalance()
  const available = data?.available
  const fiat = data?.fiat
  const status = denied ? 'Balance restricted' : stale ? (data ? 'Last known balance' : 'Balance unavailable') : loading ? 'Updating balance' : 'Balance'
  const label = `${available == null ? 'Hane ledger' : `${formatHane(available)} Hane${fiat ? ` · ${fiat}` : ''}`} · ${status}${observedAt ? ` · checked ${new Date(observedAt).toLocaleTimeString()}` : ''}`
  return (
    <a
      href="https://cortex.shizuha.com/cortex/usage#hane"
      className="inline-flex min-w-0 max-w-[12rem] items-center gap-1 sm:gap-1.5 rounded-full border border-amber-400/40 bg-amber-50/80 px-2.5 py-1 dark:bg-amber-950/40 dark:border-amber-500/30"
      title={label}
      aria-label={label}
      data-balance-state={denied ? 'denied' : stale ? 'stale' : loading ? 'loading' : data ? 'ok' : 'unavailable'}
    >
      <span className="shrink-0"><Coin /></span>
      <span className="min-w-0 truncate font-mono text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-200">
        {available == null ? '—' : formatHane(available)}
      </span>
      <span className="hidden shrink-0 sm:inline text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Hane</span>
      {stale && <span className="shrink-0 text-[10px]" aria-hidden="true">!</span>}
      {fiat ? <span className="hidden xl:inline min-w-0 truncate font-mono text-[10px] tabular-nums text-amber-700/80 dark:text-amber-300/80">{fiat}</span> : null}
    </a>
  )
}
