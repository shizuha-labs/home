import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageCircle, ExternalLink, CornerDownLeft, ShieldCheck } from 'lucide-react'
import { SHIZUHA_APPS, useEnabledServices } from '@shizuha/ui'
import { ASSISTANT_ACTIONS, ACTION_TIERS, actionMatches, getAssistantActionExecution } from './assistantActions'

function normalizeEnabledServices(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.enabledServices)) return value.enabledServices
  return null
}

function tierClass(tier) {
  switch (ACTION_TIERS[tier]?.tone) {
    case 'emerald': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    case 'amber': return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
  }
}

export default function CommandPalette({ isOpen, onClose, onAskShizuha, onNavigate }) {
  const enabled = normalizeEnabledServices(useEnabledServices())
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [pendingConfirmation, setPendingConfirmation] = useState(null)
  const inputRef = useRef(null)

  const enabledApps = useMemo(() => SHIZUHA_APPS.filter((app) => {
    if (!enabled) return true
    return enabled.includes(app.id) || app.id === 'admin' || app.id === 'id'
  }), [enabled])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const appItems = enabledApps
      .filter((app) => !q || `${app.name} ${app.description || ''}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map((app) => ({ type: 'navigate', id: `app-${app.id}`, label: app.name, description: app.description || 'Open surface', href: app.path }))
    const actionItems = ASSISTANT_ACTIONS
      .filter((action) => actionMatches(action, query))
      .slice(0, 8)
      .map((action) => ({ type: 'action', ...action }))
    const askItem = query.trim()
      ? [{ type: 'ask', id: 'ask-shizuha', label: `Ask Shizuha: “${query.trim()}”`, description: 'Send this to the assistant with your current home context.' }]
      : []
    return [...askItem, ...actionItems, ...appItems].slice(0, 12)
  }, [enabledApps, query])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setActiveIndex(0)
    setPendingConfirmation(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isOpen])

  useEffect(() => {
    setPendingConfirmation(null)
  }, [query])

  useEffect(() => {
    setActiveIndex((idx) => Math.min(idx, Math.max(items.length - 1, 0)))
  }, [items.length])

  if (!isOpen) return null

  const finishAsk = (prompt) => {
    onAskShizuha(prompt)
    setPendingConfirmation(null)
    onClose()
  }

  const runItem = (item = items[activeIndex]) => {
    if (!item) return
    if (item.type === 'ask') return finishAsk(query.trim())
    if (item.type === 'navigate') { onNavigate(item.href); onClose(); return }

    const execution = getAssistantActionExecution(item)
    if (execution.mode === 'confirm') { setPendingConfirmation(item); return }
    if (execution.mode === 'navigate') { onNavigate(execution.href); onClose(); return }
    if (execution.mode === 'ask') finishAsk(execution.prompt)
  }

  const confirmPendingAction = () => {
    const execution = getAssistantActionExecution(pendingConfirmation, { confirmed: true })
    if (execution.mode === 'ask') finishAsk(execution.prompt)
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    if (event.key === 'Enter') { event.preventDefault(); runItem() }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-24">
      <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <Search className="h-5 w-5 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search actions, apps, or ask Shizuha…"
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          <kbd className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Esc</kbd>
        </div>
        <div className="max-h-[28rem] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-gray-400">No matching actions. Try asking Shizuha directly.</p>
          ) : items.map((item, index) => {
            const active = index === activeIndex
            const Icon = item.type === 'ask' ? MessageCircle : item.type === 'navigate' ? ExternalLink : ShieldCheck
            return (
              <button
                key={item.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runItem(item)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${active ? 'bg-brand-50 dark:bg-brand-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-900'}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
                </span>
                {item.tier ? <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tierClass(item.tier)}`}>{ACTION_TIERS[item.tier].label}</span> : null}
                {active ? <CornerDownLeft className="h-4 w-4 text-gray-300" /> : null}
              </button>
            )
          })}
        </div>
        {pendingConfirmation ? (
            <div className="border-t border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">Confirm before continuing: {pendingConfirmation.label}</p>
              <p className="mt-1 text-xs opacity-80">{pendingConfirmation.confirmationCopy}</p>
              <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                <div><dt className="font-semibold">Owner</dt><dd>{pendingConfirmation.owner}</dd></div>
                <div><dt className="font-semibold">Audit event</dt><dd>{pendingConfirmation.auditEvent}</dd></div>
                <div><dt className="font-semibold">Auth surface</dt><dd>{pendingConfirmation.authSurface}</dd></div>
                <div><dt className="font-semibold">Required inputs</dt><dd>{(pendingConfirmation.requiredInputs || []).join(', ') || 'None'}</dd></div>
              </dl>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setPendingConfirmation(null)} className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-semibold hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40">Cancel</button>
                <button onClick={confirmPendingAction} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700">Confirm and ask Shizuha</button>
              </div>
            </div>
        ) : null}
      </div>
    </div>
  )
}
