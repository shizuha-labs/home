import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Compact switcher for the home chat default agent.
 * Lists prior agent DMs; search uses the same ID/Connect people lookup as New Chat.
 */
export default function HomeAgentPicker({
  selectedUsername,
  selectedLabel,
  options,
  onSelect,
  onSearch,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open || !query.trim() || typeof onSearch !== 'function') {
      setHits([])
      return undefined
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const found = await onSearch(query.trim())
        if (!cancelled) setHits(Array.isArray(found) ? found : [])
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, query, onSearch])

  const merged = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const row of [...(options || []), ...hits]) {
      const username = String(row.username || '').trim()
      if (!username || seen.has(username.toLowerCase())) continue
      seen.add(username.toLowerCase())
      out.push(row)
    }
    return out
  }, [options, hits])

  const label = selectedLabel || selectedUsername || 'Choose an agent'

  return (
    <div ref={rootRef} className="relative mx-auto mb-4 w-full max-w-md">
      <button
        type="button"
        data-testid="home-agent-picker"
        onClick={() => setOpen((v) => !v)}
        className="mx-auto flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-gray-600 shadow-sm hover:border-brand-300 hover:text-brand-700 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300"
        title="Change who the home composer talks to"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
        </span>
        Talking to {label}
        <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-1/2 z-30 mt-2 w-72 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            className="mb-2 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-xs outline-none dark:border-gray-700"
          />
          <div className="max-h-56 overflow-y-auto">
            {merged.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-gray-400">
                {searching ? 'Searching…' : 'No agents yet. Search a username (e.g. cora).'}
              </p>
            )}
            {merged.map((row) => {
              const active = String(row.username).toLowerCase() === String(selectedUsername || '').toLowerCase()
              return (
                <button
                  key={row.username}
                  type="button"
                  onClick={() => {
                    onSelect(row)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${
                    active
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="truncate font-medium">{row.displayName || row.username}</span>
                  <span className="ml-2 truncate text-[10px] text-gray-400">@{row.username}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
