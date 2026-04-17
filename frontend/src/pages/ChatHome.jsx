import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ConnectChatProvider, ChatLayout, MessageList, MessageInput, Avatar, useConnectChat } from '@shizuha/chat'
import { SHIZUHA_APPS, useEnabledServices } from '@shizuha/ui'

const ACCESS_TOKEN_KEY = 'shizuha_access_token'
function getAuthToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || ''
}

const SUGGESTION_CHIPS = [
  { label: 'Check my financials', prompt: 'Give me an overview of my recent financial activity — revenue, expenses, and anything that needs attention.' },
  { label: 'Create a task', prompt: 'I need to create a new task. Help me set it up with the right priority and assignee.' },
  { label: 'Check my emails', prompt: 'Check my recent emails and summarize anything important or requiring a response.' },
  { label: 'Draft a document', prompt: 'Help me draft a document. I\'ll tell you what it\'s about.' },
  { label: 'HR overview', prompt: 'Give me an overview of the HR dashboard — leave requests, attendance, and any pending approvals.' },
  { label: 'Inventory status', prompt: 'What\'s the current inventory status? Any low-stock alerts or pending movements?' },
]

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function AppsDrawer({ isOpen, onClose }) {
  const { enabledServices } = useEnabledServices()
  const apps = SHIZUHA_APPS.filter(app => {
    if (!enabledServices) return true
    return enabledServices.includes(app.id) || app.id === 'admin' || app.id === 'id'
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-950 shadow-2xl border-l border-gray-200 dark:border-gray-800 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Apps</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-3 grid grid-cols-3 gap-2">
          {apps.map(app => (
            <a
              key={app.id}
              href={app.path}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            >
              <div className={`w-10 h-10 rounded-xl ${app.bgColor} flex items-center justify-center text-white text-sm font-bold shadow-sm group-hover:scale-110 transition-transform`}>
                {app.name.charAt(0)}
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400 text-center font-medium">{app.name}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function ChatHomeInner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { conversationId: urlConversationId } = useParams()
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createDirectConversation,
    isConnected,
    messages,
    typingUsers,
    onlineUsers,
    hasMore,
    isLoadingMessages,
    loadMore,
    sendMessage,
  } = useConnectChat()

  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showApps, setShowApps] = useState(false)
  const textareaRef = useRef(null)

  // Sync URL param to active conversation
  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setActiveConversation(urlConversationId)
    } else if (!urlConversationId && activeConversationId) {
      setActiveConversation(null)
    }
  }, [urlConversationId])

  // Send pending message from home input after conversation loads
  useEffect(() => {
    if (!activeConversationId || !isConnected) return
    const pending = sessionStorage.getItem('shizuha_pending_message')
    if (!pending) return
    try {
      const { conversationId, content } = JSON.parse(pending)
      if (conversationId === activeConversationId && content) {
        sessionStorage.removeItem('shizuha_pending_message')
        // Small delay to let messages load first
        setTimeout(() => sendMessage(content), 300)
      }
    } catch { /* ignore */ }
  }, [activeConversationId, isConnected, sendMessage])

  useEffect(() => {
    if (!activeConversationId) textareaRef.current?.focus()
  }, [activeConversationId])

  const sendToShizuha = useCallback(async (message) => {
    if (!message.trim() || isSending) return
    setIsSending(true)
    try {
      let shizuhaConv = conversations.find(c =>
        c.participants?.some(p => p.user_name === 'Shizuha' || p.agent_role)
      )
      if (!shizuhaConv) {
        const token = getAuthToken()
        const searchResp = await fetch(`/connect/api/people/search/?q=shizuha`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (searchResp.ok) {
          const users = await searchResp.json()
          const shizuhaUser = users.find(u => u.username === 'shizuha')
          if (shizuhaUser) {
            shizuhaConv = await createDirectConversation(shizuhaUser.id)
          }
        }
      }
      if (shizuhaConv) {
        // Store pending message so the chat view sends it after mounting
        sessionStorage.setItem('shizuha_pending_message', JSON.stringify({
          conversationId: shizuhaConv.id,
          content: message,
        }))
        setActiveConversation(shizuhaConv.id)
        navigate(`/c/${shizuhaConv.id}`)
      }
    } finally {
      setIsSending(false)
    }
  }, [conversations, createDirectConversation, navigate, setActiveConversation, isSending])

  const handleSubmit = useCallback(() => {
    if (inputValue.trim()) {
      sendToShizuha(inputValue)
      setInputValue('')
    }
  }, [inputValue, sendToShizuha])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleChipClick = useCallback((prompt) => {
    sendToShizuha(prompt)
  }, [sendToShizuha])

  const handleNavigateConversation = useCallback((id) => {
    if (id) navigate(`/c/${id}`, { replace: true })
    else navigate('/', { replace: true })
  }, [navigate])

  const firstName = user?.first_name || user?.username || ''

  // Active conversation: show chat in the same branded shell
  if (activeConversationId) {
    const activeConv = conversations.find(c => c.id === activeConversationId)
    const activeName = (() => {
      if (!activeConv) return 'Chat'
      if (activeConv.conversation_type === 'group') return activeConv.name || 'Group'
      // For direct messages, find the OTHER participant (not current user)
      const other = activeConv.participants?.find(p => p.user_id !== user?.id && !p.has_left)
      if (other?.user_name) return other.user_name
      // Fallback: find any name in participant_names that isn't the current user
      const currentName = user?.first_name || user?.username || ''
      const otherName = activeConv.participant_names?.find(n => n && n !== currentName)
      return otherName || activeConv.participant_names?.[0] || 'Chat'
    })()

    return (
      <div className="flex h-full">
        {/* Same branded sidebar */}
        <div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0 flex-col bg-gray-50/80 dark:bg-gray-900/50 border-r border-gray-200/60 dark:border-gray-800/60">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Conversations</span>
            <button
              onClick={() => navigate('/')}
              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
              title="Home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {conversations.map((conv) => {
              const other = conv.participants?.find(p => p.user_id !== user?.id)
              const name = conv.conversation_type === 'group'
                ? conv.name || 'Group'
                : other?.user_name || conv.participant_names?.[0] || 'Chat'
              const hasUnread = conv.unread_count > 0
              const isActive = conv.id === activeConversationId
              return (
                <button
                  key={conv.id}
                  onClick={() => {
                    setActiveConversation(conv.id)
                    navigate(`/c/${conv.id}`, { replace: true })
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded-lg text-left transition-all ${
                    isActive
                      ? 'bg-brand-50 dark:bg-brand-950/30'
                      : 'hover:bg-white dark:hover:bg-gray-800'
                  }`}
                >
                  <Avatar
                    name={name}
                    size="sm"
                    isOnline={other ? onlineUsers.has(other.user_id) : false}
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
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{conv.last_message_preview || ''}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Chat area with branded background */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-950">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-800/60 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
            <button
              onClick={() => { navigate('/'); setActiveConversation(null) }}
              className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Avatar name={activeName} size="sm" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{activeName}</h3>
            {!isConnected && (
              <span className="flex items-center gap-1 text-xs text-amber-500 ml-auto">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Reconnecting
              </span>
            )}
          </div>

          {/* Messages + Input from @shizuha/chat */}
          <MessageList
            messages={messages}
            currentUserId={user?.id}
            typingUsers={activeConversationId ? typingUsers.get(activeConversationId) : undefined}
            hasMore={hasMore}
            isLoadingMore={isLoadingMessages}
            onLoadMore={loadMore}
          />
          <MessageInput
            onSend={sendMessage}
            disabled={!isConnected}
            placeholder={isConnected ? `Message ${activeName}...` : 'Connecting...'}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0 flex-col bg-gray-50/80 dark:bg-gray-900/50 border-r border-gray-200/60 dark:border-gray-800/60">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Conversations</span>
          <button
            onClick={() => navigate('/c')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
            title="All conversations"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {conversations.slice(0, 12).map((conv) => {
            const other = conv.participants?.find(p => p.user_id !== user?.id)
            const name = conv.conversation_type === 'group'
              ? conv.name || 'Group'
              : other?.user_name || conv.participant_names?.[0] || 'Chat'
            const hasUnread = conv.unread_count > 0
            return (
              <button
                key={conv.id}
                onClick={() => {
                  setActiveConversation(conv.id)
                  navigate(`/c/${conv.id}`)
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded-lg text-left hover:bg-white dark:hover:bg-gray-800 transition-all"
              >
                <Avatar
                  name={name}
                  size="sm"
                  isOnline={other ? onlineUsers.has(other.user_id) : false}
                  showStatus={conv.conversation_type === 'direct'}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${hasUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                      {name}
                    </p>
                    {hasUnread && (
                      <span className="flex-shrink-0 ml-1 min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold">
                        {conv.unread_count > 99 ? '99+' : conv.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{conv.last_message_preview || ''}</p>
                </div>
              </button>
            )
          })}
          {conversations.length > 12 && (
            <button onClick={() => navigate('/c')} className="w-full py-2 text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 font-medium">
              View all {conversations.length} conversations
            </button>
          )}
        </div>
      </div>

      {/* Main — same visual language as Hero */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Background — matches gradient-hero-light exactly */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-950 dark:to-purple-950 pointer-events-none" />
        {/* Decorative orbs — same as Hero */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-brand-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 w-full max-w-2xl px-6 pb-20">
          {/* Brand — same treatment as Hero */}
          <div className="text-center mb-4">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight">
              <span className="text-brand-400/60 dark:text-brand-500/40">静葉</span>{' '}
              <span className="text-gray-800 dark:text-gray-200 font-medium">Shizuha</span>
            </h1>
          </div>

          {/* Greeting — personalized */}
          <p className="text-lg text-gray-600 dark:text-gray-400 text-center mb-8">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}. How can I help?
          </p>

          {/* Input — dark card style matching the Hero code block */}
          <div className="relative mb-8">
            <div className="rounded-2xl bg-white dark:bg-gray-900 shadow-xl shadow-brand-900/5 dark:shadow-black/20 ring-1 ring-gray-200 dark:ring-gray-700 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask Shizuha anything..."
                rows={2}
                disabled={isSending}
                className="w-full px-5 py-4 pb-12 text-base bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none resize-none max-h-40"
              />
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                {!isConnected && (
                  <span className="flex items-center gap-1 text-xs text-amber-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Connecting
                  </span>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!inputValue.trim() || isSending}
                  className="w-9 h-9 rounded-xl bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip.label}
                onClick={() => handleChipClick(chip.prompt)}
                disabled={isSending}
                className="px-4 py-3 text-left text-sm rounded-xl bg-white/60 dark:bg-gray-800/40 backdrop-blur-sm ring-1 ring-gray-200/60 dark:ring-gray-700/40 text-gray-600 dark:text-gray-400 hover:ring-brand-300 dark:hover:ring-brand-600 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-white dark:hover:bg-gray-800/80 hover:shadow-lg hover:shadow-brand-500/5 transition-all disabled:opacity-50"
              >
                <span className="font-medium">{chip.label}</span>
              </button>
            ))}
          </div>

          {/* Trust line — same as Hero */}
          <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-8">
            Self-hosted. Open MCP servers. Your data stays on your infrastructure.
          </p>
        </div>
      </div>

      {/* Apps drawer */}
      <AppsDrawer isOpen={showApps} onClose={() => setShowApps(false)} />
    </div>
  )
}

export default function ChatHome() {
  const { user } = useAuth()

  return (
    <ConnectChatProvider
      getAuthToken={getAuthToken}
      connectApiBase="/connect/api"
      currentUserId={user?.id}
    >
      <ChatHomeInner />
    </ConnectChatProvider>
  )
}
