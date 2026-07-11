import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ConnectChatProvider, ChatLayout, MessageList, MessageInput, Avatar, NewChatModal, useConnectChat } from '@shizuha/chat'
import { SHIZUHA_APPS, useEnabledServices } from '@shizuha/ui'
import CommandCenterDashboard from '../components/dashboard/CommandCenterDashboard'
import LiveTheater from '../components/dashboard/LiveTheater'
import CockpitPeek from '../components/dashboard/CockpitPeek'
import CommandPalette from '../components/assistant/CommandPalette'
import MiniShizuhaChat from '../components/assistant/MiniShizuhaChat'
import { useVoiceInput, useVoiceConversation, speakText } from '../hooks/useVoice'
import { useHomeSummary } from '../hooks/useHomeSummary'
import { useHomeActivity } from '../hooks/useHomeActivity'
import { getAccessToken, handleUnauthorized } from '../utils/auth'

function getAuthToken() {
  return getAccessToken()
}

const SUGGESTION_CHIPS = [
  { label: 'Check my financials', prompt: 'Give me an overview of my recent financial activity — revenue, expenses, and anything that needs attention.' },
  { label: 'Create a task', prompt: 'I need to create a new task. Help me set it up with the right priority and assignee.' },
  { label: 'Check my emails', prompt: 'Check my recent emails and summarize anything important or requiring a response.' },
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
  // Inline mini-chat (operator 2026-07-11): chat with Shizuha while STAYING on
  // the home page. When set, the Shizuha conversation is ACTIVE in the provider
  // (messages stream in) but we render a rolling strip instead of navigating.
  const [miniConvId, setMiniConvId] = useState(null)
  const [speakReplies, setSpeakReplies] = useState(() => localStorage.getItem('shizuha_speak_replies') === '1')
  const lastSpokenIdRef = useRef(null)
  const [showApps, setShowApps] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const textareaRef = useRef(null)
  const { summary } = useHomeSummary()
  const orgs = Array.isArray(summary?.orgs) ? summary.orgs : null
  // HIVE-602 live theater: fast-poll the org's activity so the home MOVES.
  const { widget: activityWidget } = useHomeActivity()
  const feedWidget = activityWidget('feed')
  const agentsWidget = activityWidget('agents')
  const liveAgents =
    agentsWidget.status === 'ok' || agentsWidget.status === 'stale'
      ? (agentsWidget.data || []).filter((a) => a.status === 'running')
      : []
  const allAgents =
    agentsWidget.status === 'ok' || agentsWidget.status === 'stale'
      ? agentsWidget.data || [] : []
  // HIVE-602 cockpit peeks: drill into agents/orgs/tasks without leaving home.
  const [peekStack, setPeekStack] = useState([])
  const pushPeek = (p) => setPeekStack((st) => [...st.slice(-4), p])
  const peekAgent = (a) => a?.email && pushPeek({
    type: 'agent', email: String(a.email).toLowerCase(), username: a.username,
    name: a.name, role: a.role, teams: a.teams, model: a.model, status: a.status,
  })
  const peekTask = (key, title) => key && pushPeek({ type: 'task', itemKey: key, itemTitle: title })
  const peekOrg = (o) => o?.id && pushPeek({ type: 'org', orgId: o.id, name: o.name })

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setShowCommandPalette(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Fetch pending connection requests count
  useEffect(() => {
    (async () => {
      try {
        const token = getAuthToken()
        const res = await fetch('/connect/api/connections/requests/', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (handleUnauthorized(res)) return
        if (res.ok) {
          const data = await res.json()
          setPendingRequestCount(Array.isArray(data) ? data.length : 0)
        }
      } catch { /* ignore */ }
    })()
  }, [])

  // Sync URL param to active conversation. The mini chat activates the
  // Shizuha conversation WITHOUT a /c/:id URL — don't clear it here.
  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setMiniConvId(null)
      setActiveConversation(urlConversationId)
    } else if (!urlConversationId && activeConversationId && activeConversationId !== miniConvId) {
      setActiveConversation(null)
    }
  }, [activeConversationId, miniConvId, setActiveConversation, urlConversationId])

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
      // Mini chat already live: just send on the active conversation.
      if (miniConvId && activeConversationId === miniConvId) {
        sendMessage(message)
        return
      }
      let shizuhaConv = conversations.find(c =>
        c.participants?.some(p => p.user_name === 'Shizuha' || p.agent_role)
      )
      if (!shizuhaConv) {
        const token = getAuthToken()
        const searchResp = await fetch(`/connect/api/search/people/?q=shizuha`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (handleUnauthorized(searchResp)) return
        if (searchResp.ok) {
          const data = await searchResp.json()
          const users = Array.isArray(data) ? data : (data.results || data.people || [])
          const shizuhaUser = users.find(u => u.username === 'shizuha')
          if (shizuhaUser) {
            shizuhaConv = await createDirectConversation(shizuhaUser.id)
          }
        }
      }
      if (shizuhaConv) {
        // Store pending message; the existing pending-message effect sends it
        // once the conversation is active + connected (works without navigating).
        sessionStorage.setItem('shizuha_pending_message', JSON.stringify({
          conversationId: shizuhaConv.id,
          content: message,
        }))
        // Operator 2026-07-11: STAY on the home page — open the inline mini
        // chat instead of navigating to the full /c/:id view.
        setMiniConvId(shizuhaConv.id)
        setActiveConversation(shizuhaConv.id)
      }
    } finally {
      setIsSending(false)
    }
  }, [activeConversationId, conversations, createDirectConversation, isSending, miniConvId, sendMessage, setActiveConversation])

  const closeMiniChat = useCallback(() => {
    setMiniConvId(null)
    setActiveConversation(null)
  }, [setActiveConversation])

  const openFullFromMini = useCallback(() => {
    if (!miniConvId) return
    const id = miniConvId
    setMiniConvId(null)
    navigate(`/c/${id}`)
  }, [miniConvId, navigate])

  // Hands-free voice call (operator 2026-07-11): listen → transcribe → send →
  // speak the reply → listen again. onUtterance fires when the caller finishes
  // an utterance; we send it to Shizuha and the reply is spoken by the effect
  // below once it streams in.
  const { callState, startCall, endCall, notifyReply, isCallActive } = useVoiceConversation({
    onUtterance: (text) => { sendToShizuha(text) },
  })
  const callActive = callState !== 'idle'

  const toggleCall = useCallback(() => {
    if (isCallActive()) { endCall(); return }
    startCall()
  }, [isCallActive, startCall, endCall])

  // Speak Shizuha's newest message. During a live call this drives the loop
  // (speak → re-listen via notifyReply); otherwise it honors the speak toggle.
  useEffect(() => {
    if (!miniConvId || activeConversationId !== miniConvId) return
    const list = Array.isArray(messages) ? messages : []
    const last = list[list.length - 1]
    if (!last || last.sender_id === user?.id) return
    const key = last.id || last.client_message_id
    if (!key || lastSpokenIdRef.current === key) return
    if (callActive) {
      lastSpokenIdRef.current = key
      notifyReply(last.content)
    } else if (speakReplies) {
      lastSpokenIdRef.current = key
      speakText(last.content)
    }
  }, [messages, speakReplies, callActive, notifyReply, miniConvId, activeConversationId, user?.id])

  const toggleSpeakReplies = useCallback(() => {
    setSpeakReplies((v) => {
      const next = !v
      localStorage.setItem('shizuha_speak_replies', next ? '1' : '0')
      if (!next) speakText.stop?.()
      return next
    })
  }, [])

  // Voice input: hold-to-talk / tap-to-toggle mic. Transcript lands in the
  // input box so the user can review before sending (or auto-send on final).
  const { micState, micSupported, toggleMic } = useVoiceInput({
    onTranscript: (text, { final }) => {
      setInputValue(text)
      if (final && text.trim()) {
        sendToShizuha(text)
        setInputValue('')
      }
    },
  })

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

  const handlePaletteNavigate = useCallback((href) => {
    if (!href) return
    if (href.startsWith('/c')) navigate(href)
    else window.location.assign(href)
  }, [navigate])

  const handleCreateOrgRoute = useCallback(() => {
    window.location.assign('/hive?intent=create-org')
  }, [])

  const handleAskCreateOrg = useCallback(() => {
    sendToShizuha('I do not have an organization yet. Help me create one from a template and route me to the guided wizard when ready.')
  }, [sendToShizuha])

  const handleNewChatUser = useCallback(async (userId, details) => {
    const conv = await createDirectConversation(userId, details)
    if (conv) {
      setActiveConversation(conv.id)
      navigate(`/c/${conv.id}`)
      setShowNewChat(false)
    }
  }, [createDirectConversation, setActiveConversation, navigate])

  const handleNavigateConversation = useCallback((id) => {
    if (id) navigate(`/c/${id}`, { replace: true })
    else navigate('/', { replace: true })
  }, [navigate])

  const firstName = user?.first_name || user?.username || ''

  // Active conversation VIA URL: show the full chat in the same branded shell.
  // (A mini-chat activation keeps activeConversationId set WITHOUT a URL — the
  // home layout below renders the inline strip instead.)
  if (activeConversationId && urlConversationId) {
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
      <>
      <div className="flex h-full">
        {/* Same branded sidebar */}
        <div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0 flex-col bg-gray-50/80 dark:bg-gray-900/50 border-r border-gray-200/60 dark:border-gray-800/60">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Conversations</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowNewChat(true)}
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
              <button
                onClick={() => { navigate('/'); setActiveConversation(null) }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
                title="Home"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              </button>
            </div>
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
      <NewChatModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onSelectUser={handleNewChatUser}
        apiBase="/connect/api"
        getAuthToken={getAuthToken}
        currentUserId={user?.id}
      />
      </>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0 flex-col bg-gray-50/80 dark:bg-gray-900/50 border-r border-gray-200/60 dark:border-gray-800/60">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Conversations</span>
          <button
            onClick={() => setShowNewChat(true)}
            className="relative p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors"
            title="New chat / Connect requests"
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

      {/* Main — same visual language as Hero. Scrolls: the live theater below
          grows with the org's activity (HIVE-602). */}
      <div className="flex-1 flex flex-col items-center justify-start relative overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-950 dark:to-purple-950">
        {/* Background gradient lives ON the scroll container: as an absolute
            inset-0 child it only covered the first viewport, so scrolling
            revealed the bare page background (black in dark mode) below it
            (operator 2026-07-10). Decorative orbs stay as top-area accents. */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-brand-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-[520px] right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 w-full max-w-3xl px-6 pt-12 pb-20">
          {/* Brand — same treatment as Hero */}
          <div className="text-center mb-4">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight">
              <span className="text-brand-400/60 dark:text-brand-500/40">静葉</span>{' '}
              <span className="text-gray-800 dark:text-gray-200 font-medium">Shizuha</span>
            </h1>
          </div>

          {/* Greeting — the org is WORKING; say so with live numbers, not
              chatbot copy (operator directive 2026-07-10). */}
          <p className="text-lg text-gray-600 dark:text-gray-400 text-center mb-2">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}.
          </p>
          {liveAgents.length > 0 && (
            <p className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Your organization is working — {liveAgents.length} agents on the job right now.
            </p>
          )}

          {orgs && orgs.length === 0 && (
            <div className="mb-6 rounded-2xl border border-brand-200/70 bg-white/75 p-4 text-left shadow-lg shadow-brand-900/5 backdrop-blur-sm dark:border-brand-900/60 dark:bg-gray-900/60">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">You don’t have an organization yet.</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Create one from a template to unlock agents, work, and the command-center dashboard.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={handleCreateOrgRoute} className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700">Open org wizard</button>
                <button onClick={handleAskCreateOrg} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300">Ask Shizuha to guide me</button>
              </div>
            </div>
          )}

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
                  onClick={() => setShowCommandPalette(true)}
                  title="Open command palette"
                  className="hidden sm:inline-flex items-center rounded-lg px-1.5 py-1 text-[10px] font-medium text-gray-400 ring-1 ring-gray-200 transition-colors hover:text-brand-600 hover:ring-brand-300 dark:text-gray-500 dark:ring-gray-700 dark:hover:text-brand-400"
                >
                  ⌘K
                </button>
                {micSupported && (
                  <button
                    onClick={toggleMic}
                    title={micState === 'listening' ? 'Stop listening' : micState === 'transcribing' ? 'Transcribing…' : 'Speak to Shizuha'}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                      micState === 'listening'
                        ? 'bg-red-500 text-white animate-pulse'
                        : micState === 'transcribing'
                          ? 'bg-amber-400 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-brand-50 hover:text-brand-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-brand-400'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={toggleCall}
                  title={callActive ? 'End voice call' : 'Start a hands-free voice call with Shizuha'}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                    callActive
                      ? 'bg-emerald-500 text-white animate-pulse'
                      : 'bg-gray-100 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-emerald-400'
                  }`}
                >
                  {callActive ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.36 11.36 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.24.2 2.45.57 3.56a1 1 0 01-.24 1.02l-2.21 2.21z" transform="rotate(135 12 12)" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.36 11.36 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.24.2 2.45.57 3.56a1 1 0 01-.24 1.02l-2.21 2.21z" />
                    </svg>
                  )}
                </button>
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

            {/* Inline mini chat (operator 2026-07-11): rolling 2-3 line strip —
                talk with Shizuha without leaving the home page. */}
            {miniConvId && activeConversationId === miniConvId && (
              <MiniShizuhaChat
                messages={messages}
                typingUsers={typingUsers}
                currentUserId={user?.id}
                isLoading={isLoadingMessages}
                onOpenFull={openFullFromMini}
                onClose={closeMiniChat}
                speakEnabled={speakReplies}
                onToggleSpeak={toggleSpeakReplies}
                callState={callState}
                onToggleCall={toggleCall}
              />
            )}
          </div>

          {/* HIVE-602: the live theater — agents visibly working, events
              streaming in, projects moving. The show. */}
          <LiveTheater feed={feedWidget} agents={agentsWidget} onPeekAgent={peekAgent} onPeekTask={peekTask} />


          {/* HIVE-376: command-center dashboard — a concise, live, access-scoped
              view of the user's orgs / agents / work / money / alerts, hydrating
              independently from the HIVE-375 aggregation API. Chat stays the heart
              above; this is the "everything at a glance" surface below it. */}
          <div className="mt-8">
            <CommandCenterDashboard onPeekOrg={peekOrg} />
          </div>
        </div>
      </div>

      {/* New chat / connect requests modal */}
      <NewChatModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onSelectUser={handleNewChatUser}
        apiBase="/connect/api"
        getAuthToken={getAuthToken}
        currentUserId={user?.id}
      />

      {/* Apps drawer */}
      <AppsDrawer isOpen={showApps} onClose={() => setShowApps(false)} />

      {peekStack.length > 0 && (
        <CockpitPeek
          stack={peekStack}
          onPush={pushPeek}
          onPop={() => setPeekStack((st) => st.slice(0, -1))}
          onClose={() => setPeekStack([])}
          agents={allAgents}
          feed={feedWidget.status === 'ok' || feedWidget.status === 'stale' ? feedWidget.data || [] : []}
        />
      )}

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onAskShizuha={sendToShizuha}
        onNavigate={handlePaletteNavigate}
      />
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
