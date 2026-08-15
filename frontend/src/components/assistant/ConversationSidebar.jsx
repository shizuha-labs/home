import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '@shizuha/chat'
import { sanitizeMessagePreview } from '../../utils/messagePreview'
import { conversationMatchesQuery } from '../../hooks/useHomeAgentPreference'
import { conversationPeerName } from '../../utils/conversationLabel'

/**
 * Home conversation rail: search existing chats AND start a chat with a
 * fleet agent who has no thread yet (Hina was invisible here).
 */
export default function ConversationSidebar({
  conversations = [],
  activeConversationId,
  currentUserId,
  onlineUsers,
  pendingRequestCount = 0,
  onSelectConversation,
  onNewChat,
  onHome,
  onSearchAgents,
  onStartAgent,
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations
    return conversations.filter((c) => conversationMatchesQuery(c, query, currentUserId))
  }, [conversations, query, currentUserId])

  useEffect(() => {
    const q = query.trim()
    if (!q || typeof onSearchAgents !== 'function') {
      setHits([])
      return undefined
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const found = await onSearchAgents(q)
        if (!cancelled) setHits(Array.isArray(found) ? found : [])
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, onSearchAgents])

  const extraHits = useMemo(() => {
    if (!query.trim()) return []
    const listed = new Set()
    for (const conv of conversations) {
      for (const p of conv.participants || []) {
        const name = String(p.username || p.user_name || '').toLowerCase()
        if (name) listed.add(name)
      }
    }
    return hits.filter((row) => {
      const username = String(row.username || '').toLowerCase()
      return username && !listed.has(username)
    })
  }, [hits, conversations, query])

  return (
    <div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0 flex-col bg-gray-50/80 dark:bg-gray-900/50 border-r border-gray-200/60 dark:border-gray-800/60">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Conversations</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            className="relative p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
            title="New chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {pendingRequestCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[0.875rem] h-3.5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                {pendingRequestCount}
              </span>
            )}
          </button>
          {typeof onHome === 'function' && (
            <button
              type="button"
              onClick={onHome}
              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
              title="Home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="px-3 pb-2">
        <label className="sr-only" htmlFor="home-conversation-search">Search conversations</label>
        <input
          id="home-conversation-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or start a chat"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.map((conv) => {
          const other = conv.participants?.find((p) => p.user_id !== currentUserId)
          const name = conversationPeerName(conv, currentUserId)
          const hasUnread = conv.unread_count > 0
          const isActive = conv.id === activeConversationId
          const preview = sanitizeMessagePreview(conv.last_message_preview || '')
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelectConversation(conv.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded-lg text-left transition-all ${
                isActive
                  ? 'bg-brand-50 dark:bg-brand-950/30'
                  : 'hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              <Avatar
                name={name}
                size="sm"
                isOnline={other ? onlineUsers?.has(other.user_id) : false}
                showStatus={conv.conversation_type === 'direct'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className={`text-sm truncate ${
                    isActive ? 'font-semibold text-brand-700 dark:text-brand-300'
                      : hasUnread ? 'font-semibold text-gray-900 dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    {name}
                  </p>
                  {hasUnread && !isActive && (
                    <span className="flex-shrink-0 ml-1 min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate" data-testid="conversation-preview">
                  {preview.chip && (
                    <span className="mr-1 inline-block rounded bg-gray-100 dark:bg-gray-800 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {preview.chip}
                    </span>
                  )}
                  {preview.text || ''}
                </p>
              </div>
            </button>
          )
        })}
        {extraHits.length > 0 && (
          <div className="mt-2 border-t border-gray-200/70 pt-2 dark:border-gray-800">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Agents</p>
            {extraHits.map((row) => (
              <button
                key={row.username}
                type="button"
                onClick={() => onStartAgent?.(row)}
                className="w-full flex items-center gap-3 px-3 py-2 mb-0.5 rounded-lg text-left hover:bg-white dark:hover:bg-gray-800"
              >
                <Avatar name={row.displayName || row.username} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{row.displayName || row.username}</p>
                  <p className="text-[11px] text-gray-400 truncate">@{row.username} · start chat</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {query.trim() && filtered.length === 0 && extraHits.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-gray-400">
            {searching ? 'Searching…' : 'No conversations or agents match.'}
          </p>
        )}
      </div>
    </div>
  )
}
