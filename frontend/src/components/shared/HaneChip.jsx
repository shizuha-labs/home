import { useEffect, useState } from 'react'
import { getAccessToken } from '../../utils/auth'

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

export default function HaneChip() {
  const [available, setAvailable] = useState(null)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) return undefined
    let cancelled = false
    fetch('/api/cortex/v1/hane', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.available === 'number') {
          setAvailable(data.available)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (available == null) return null
  return (
    <a
      href="https://cortex.shizuha.com/cortex/usage#hane"
      className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-50/80 px-2.5 py-1 dark:bg-amber-950/40 dark:border-amber-500/30"
      title={`${available.toLocaleString('en-IN')} Hane`}
    >
      <Coin />
      <span className="font-mono text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-200">
        {available.toLocaleString('en-IN')}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Hane</span>
    </a>
  )
}
