import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ConnectChatProvider, MessageList, MessageInput, Avatar, NewChatModal, useConnectChat } from '@shizuha/chat'
import { SHIZUHA_APPS, useEnabledServices } from '@shizuha/ui'
import CommandCenterDashboard from '../components/dashboard/CommandCenterDashboard'
import LiveTheater from '../components/dashboard/LiveTheater'
import CockpitPeek from '../components/dashboard/CockpitPeek'
import OrgProgressCharts from '../components/dashboard/OrgProgressCharts'
import CommandPalette from '../components/assistant/CommandPalette'
import MiniShizuhaChat from '../components/assistant/MiniShizuhaChat'
import HomeAgentPicker from '../components/assistant/HomeAgentPicker'
import ConversationSidebar from '../components/assistant/ConversationSidebar'
import LiveVoiceOverlay from '../components/assistant/LiveVoiceOverlay'
import LiveWaveformIcon from '../components/assistant/LiveWaveformIcon'
import {
  agentConversations,
  findAgentConversation,
  mergeAgentSearchHits,
  readHomeAgentPref,
  resolveHomeAgentUsername,
  RETIRED_HOME_AGENTS,
  writeHomeAgentPref,
} from '../hooks/useHomeAgentPreference'
import { useVoiceInput, useVoiceConversation, speakText, speakDelta, nextSpokenSentences, spokenCovers, stripSpeakableMarkup, isTalkAckText, isGhostTranscript } from '../hooks/useVoice'
import { useHomeSummary } from '../hooks/useHomeSummary'
import { useHomeActivity } from '../hooks/useHomeActivity'
import { getAccessToken, handleUnauthorized } from '../utils/auth'
import { conversationPeerName } from '../utils/conversationLabel'
import { conversationIdFromPath, isHomeAppPath, nextThreadAfterRouteChange } from '../utils/conversationRoute'

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
  const { pathname } = useLocation()
  const urlConversationId = useParams().conversationId || conversationIdFromPath(pathname)
  const {
    conversations,
    activeConversationId,
    activeInitialUnread,
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
    streamingByConv,
  } = useConnectChat()

  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  // Inline mini-chat (operator 2026-07-11): chat with Shizuha while STAYING on
  // the home page. When set, the Shizuha conversation is ACTIVE in the provider
  // (messages stream in) but we render a rolling strip instead of navigating.
  const [miniConvId, setMiniConvId] = useState(null)
  const [homeAgent, setHomeAgent] = useState(() => readHomeAgentPref())
  const [sendError, setSendError] = useState('')
  const [speakReplies, setSpeakReplies] = useState(() => localStorage.getItem('shizuha_speak_replies') === '1')
  const lastSpokenIdRef = useRef(null)
  const [showApps, setShowApps] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const textareaRef = useRef(null)
  const { summary } = useHomeSummary()
  const orgs = Array.isArray(summary?.orgs) ? summary.orgs : null
  // Org-progress panel: per-org selection (defaults to the first org) + range.
  const [progressOrgId, setProgressOrgId] = useState(null)
  const [progressRange, setProgressRange] = useState('24h')
  const effectiveProgressOrgId = progressOrgId ?? orgs?.[0]?.id ?? null
  // HIVE-602 live theater: fast-poll the org's activity so the home MOVES.
  const { widget: activityWidget } = useHomeActivity()
  const feedWidget = activityWidget('feed')
  const agentsWidget = activityWidget('agents')
  const liveAgents =
    agentsWidget.status === 'ok' || agentsWidget.status === 'stale'
      ? (agentsWidget.data || []).filter((a) => a.status === 'running')
      : []
  const allAgents = useMemo(
    () => (
      agentsWidget.status === 'ok' || agentsWidget.status === 'stale'
        ? agentsWidget.data || []
        : []
    ),
    [agentsWidget.status, agentsWidget.data],
  )
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

  const pickerOptions = useMemo(
    () => agentConversations(conversations, user?.id),
    [conversations, user?.id],
  )
  const effectiveHomeAgent = resolveHomeAgentUsername(homeAgent, user)
  useEffect(() => {
    const raw = String(homeAgent || '').trim().toLowerCase()
    if (raw && RETIRED_HOME_AGENTS.has(raw)) {
      const next = resolveHomeAgentUsername('', user)
      writeHomeAgentPref(next)
      setHomeAgent(next)
    }
  }, [homeAgent, user])
  const selectedPicker = pickerOptions.find(
    (row) => String(row.username).toLowerCase() === String(effectiveHomeAgent).toLowerCase(),
  )

  const chooseHomeAgent = useCallback((row) => {
    const username = writeHomeAgentPref(row?.username)
    setHomeAgent(username)
    if (row?.conversationId) {
      setMiniConvId(row.conversationId)
      setActiveConversation(row.conversationId)
    }
  }, [setActiveConversation])

  const searchHomeAgents = useCallback(async (q) => {
    const token = getAuthToken()
    const headers = { Authorization: `Bearer ${token}` }
    const ql = q.toLowerCase()
    const localAgents = (allAgents || [])
      .filter((a) => {
        const blob = `${a.name || ''} ${a.username || ''} ${a.email || ''} ${(a.role || '')}`.toLowerCase()
        return blob.includes(ql)
      })
      .map((a) => ({
        userId: a.user_id || a.identity_user_id || null,
        username: a.username,
        displayName: a.name || a.username,
        email: a.email || (a.username ? `${a.username}@shizuha.com` : ''),
      }))
    const fetches = [
      fetch(`/api/home/talk-agents?q=${encodeURIComponent(q)}`, { headers })
        .then(async (res) => {
          if (!res.ok) return []
          const data = await res.json()
          return data.results ?? data.agents ?? []
        })
        .catch(() => []),
      fetch('/id/api/auth/users/all/', { headers })
        .then(async (idRes) => {
          if (!idRes.ok) return []
          const data = await idRes.json()
          return (data.users ?? [])
            .filter((u) => u.id !== user?.id)
            .map((u) => ({
              userId: u.id,
              username: u.username,
              displayName: u.first_name || u.username,
              email: u.email,
            }))
            .filter((u) => {
              const blob = `${u.displayName} ${u.username} ${u.email || ''}`.toLowerCase()
              return blob.includes(ql)
            })
        })
        .catch(() => []),
      fetch(`/connect/api/search/people/?q=${encodeURIComponent(q)}`, { headers })
        .then(async (res) => {
          if (!res.ok) return []
          const data = await res.json()
          return (data.results ?? data ?? []).map((u) => ({
            userId: u.id || u.user_id,
            username: u.username,
            displayName: u.first_name || u.display_name || u.username,
            email: u.email,
          }))
        })
        .catch(() => []),
    ]
    const [hiveHits, idHits, connectHits] = await Promise.all(fetches)
    return mergeAgentSearchHits(localAgents, hiveHits, idHits, connectHits).slice(0, 16)
  }, [allAgents, user?.id])

  const sendToShizuha = useCallback(async (message) => {
    if (!message.trim() || isSending) return
    const targetUsername = resolveHomeAgentUsername(homeAgent, user)
    if (!targetUsername) {
      setSendError('Choose an agent above, then ask.')
      return
    }
    setIsSending(true)
    setSendError('')
    try {
      // Already on this thread (/c/:id or mini-chat): send now. The pending-
      // message hop is only for opening a new conversation from home.
      if (activeConversationId) {
        const live = findAgentConversation(conversations, targetUsername)
        if (!live || live.id === activeConversationId) {
          sendMessage(message)
          return
        }
      }
      let dest = findAgentConversation(conversations, targetUsername)
      if (!dest) {
        const matches = await searchHomeAgents(targetUsername)
        const hit = matches.find((m) => String(m.username).toLowerCase() === targetUsername.toLowerCase())
        if (hit?.userId) {
          dest = await createDirectConversation(hit.userId, { name: hit.displayName, email: hit.email })
        } else if (hit) {
          setSendError(`${hit.displayName || targetUsername} is not on Shizuha ID yet, so a chat cannot start.`)
          return
        }
      }
      if (dest) {
        sessionStorage.setItem('shizuha_pending_message', JSON.stringify({
          conversationId: dest.id,
          content: message,
        }))
        setMiniConvId(dest.id)
        setActiveConversation(dest.id)
      } else {
        setSendError(`Couldn't find ${targetUsername} in chat or the fleet.`)
      }
    } finally {
      setIsSending(false)
    }
  }, [activeConversationId, conversations, createDirectConversation, homeAgent, isSending, searchHomeAgents, sendMessage, setActiveConversation, user])

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
  const { callState, callError, muted, lastHeard, startCall, endCall, retryCall, toggleMute, notifyReply, beginSpeak, endSpeak, isCallActive } = useVoiceConversation({
    onUtterance: (text) => {
      if (activeConversationId) sendMessage(text)
      else sendToShizuha(text)
    },
  })
  // Streaming STT types into the compose box as the caller speaks.
  useEffect(() => {
    if (callState === 'listening' && lastHeard) setInputValue(lastHeard)
  }, [callState, lastHeard])
  const lastAgentReply = useMemo(() => {
    const list = Array.isArray(messages) ? messages : []
    const last = [...list].reverse().find((m) => (
      m.sender_id !== user?.id && !isTalkAckText(m.content) && !isGhostTranscript(m.content)
    ))
    return last?.content || ''
  }, [messages, user?.id])
  const displayMessages = useMemo(
    () => (Array.isArray(messages)
      ? messages.filter((m) => !isTalkAckText(m?.content) && !isGhostTranscript(m?.content))
      : messages),
    [messages],
  )
  // Active = mid-call only. 'error' is a terminal surface with guidance/retry, not "on call".
  const callActive = callState !== 'idle' && callState !== 'error'
  const callFailed = callState === 'error'

  const goHome = useCallback(() => {
    if (activeConversationId && callState !== 'idle') {
      setMiniConvId(activeConversationId)
    } else {
      setMiniConvId(null)
      setActiveConversation(null)
    }
    navigate('/')
  }, [activeConversationId, callState, navigate, setActiveConversation])

  useEffect(() => {
    const next = nextThreadAfterRouteChange({
      urlConversationId,
      activeConversationId,
      miniConvId,
      callState,
    })
    if (next.miniConvId !== miniConvId) setMiniConvId(next.miniConvId)
    if (next.activeConversationId !== activeConversationId) {
      setActiveConversation(next.activeConversationId)
    }
  }, [activeConversationId, callState, miniConvId, setActiveConversation, urlConversationId])

  const toggleCall = useCallback(() => {
    if (isCallActive()) { endCall(); return }
    if (callState === 'error') {
      // Re-tap after a hard fail: mic errors dismiss; stream errors manual-retry.
      if (callError?.canRetry) retryCall()
      else endCall()
      return
    }
    startCall()
    // Homepage Live needs a thread immediately so Open full / sidebar stay
    // in-app. Waiting for the first utterance left no expand target.
    if (!urlConversationId) {
      const dest = selectedPicker?.conversationId
        || findAgentConversation(conversations, effectiveHomeAgent)?.id
      if (dest) {
        setMiniConvId(dest)
        if (dest !== activeConversationId) setActiveConversation(dest)
      }
    }
  }, [activeConversationId, callError, callState, conversations, effectiveHomeAgent, endCall, isCallActive, retryCall, selectedPicker, setActiveConversation, startCall, urlConversationId])

  // Speak tokens as they stream in (Grok TTS websocket). Fallback: full
  // message once persisted. Persist must NOT reset the spoken prefix or the
  // same reply is synthesized twice (double voice) and each notifyReply
  // used to open another mic (duplicate user turns).
  const spokenStreamRef = useRef('')
  const lastLiveStreamRef = useRef('')
  const voiceConvId = miniConvId || ((callActive || speakReplies) ? activeConversationId : null)
  useEffect(() => {
    if (!voiceConvId || activeConversationId !== voiceConvId) return
    if (!speakReplies && !callActive) return
    const live = streamingByConv?.[voiceConvId] || ''
    const prev = lastLiveStreamRef.current
    if (live && !prev) spokenStreamRef.current = ''
    const ended = !live && !!prev
    const source = live || (ended ? prev : '')
    if (!source) return
    lastLiveStreamRef.current = live
    const { sentences, spoken } = nextSpokenSentences(
      source,
      spokenStreamRef.current,
      { flushRemainder: ended },
    )
    if (!sentences.length) return
    spokenStreamRef.current = spoken
    beginSpeak(sentences.join(' '))
    for (const sentence of sentences) {
      void speakDelta(sentence, { done: false })
    }
  }, [beginSpeak, streamingByConv, speakReplies, callActive, voiceConvId, activeConversationId])

  // Persist is the end of the turn. Speak only leftover text. Re-listen once.
  useEffect(() => {
    if (!voiceConvId || activeConversationId !== voiceConvId) return
    const list = Array.isArray(messages) ? messages : []
    const last = list[list.length - 1]
    if (!last || last.sender_id === user?.id) return
    const key = last.id || last.client_message_id
    if (!key || lastSpokenIdRef.current === key) return
    lastSpokenIdRef.current = key
    if (isTalkAckText(last.content)) {
      lastLiveStreamRef.current = ''
      if (callActive) void endSpeak()
      return
    }
    const leftover = spokenCovers(last.content, spokenStreamRef.current)
      ? ''
      : stripSpeakableMarkup(last.content || '')
    lastLiveStreamRef.current = ''
    if (!leftover) {
      if (callActive) void endSpeak()
      return
    }
    if (callActive) notifyReply(leftover)
    else if (speakReplies) speakText(leftover)
  }, [messages, speakReplies, callActive, notifyReply, endSpeak, voiceConvId, activeConversationId, user?.id])

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
    if (isHomeAppPath(href)) navigate(href)
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

  const startAgentFromSearch = useCallback(async (row) => {
    if (!row) return
    writeHomeAgentPref(row.username)
    setHomeAgent(row.username)
    if (row.conversationId) {
      setMiniConvId(row.conversationId)
      setActiveConversation(row.conversationId)
      return
    }
    if (!row.userId) {
      setSendError(`${row.displayName || row.username} is not on Shizuha ID yet, so a chat cannot start.`)
      return
    }
    const dest = await createDirectConversation(row.userId, { name: row.displayName, email: row.email })
    if (dest) {
      setMiniConvId(dest.id)
      setActiveConversation(dest.id)
    }
  }, [createDirectConversation, setActiveConversation])

  const firstName = user?.first_name || user?.username || ''
  const threadOpen = Boolean(activeConversationId && urlConversationId)
  const activeConv = threadOpen
    ? conversations.find(c => c.id === activeConversationId)
    : null
  const activeName = threadOpen ? conversationPeerName(activeConv, user?.id) : ''
  const voiceAgentLabel = threadOpen
    ? (activeName || 'Agent')
    : (selectedPicker?.displayName || effectiveHomeAgent || 'Agent')

  const liveCallButton = (testId, label) => (
    <button
      type="button"
      data-testid={testId}
      onClick={toggleCall}
      title={
        callActive
          ? 'End Live'
          : callFailed
            ? (callError?.canRetry ? 'Retry Live' : (callError?.message || 'Voice unavailable'))
            : `Start Live with ${label}`
      }
      aria-label={
        callActive
          ? 'End Live'
          : callFailed
            ? (callError?.canRetry ? 'Retry Live' : 'Dismiss voice error')
            : 'Start Live voice'
      }
      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
        callActive
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
          : callFailed
            ? 'bg-amber-500 text-white'
            : 'bg-gray-100 text-gray-500 hover:bg-brand-50 hover:text-brand-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-brand-400'
      }`}
    >
      <LiveWaveformIcon className="w-4 h-4" active={callActive} />
    </button>
  )

  return (
    <>
    {threadOpen ? (
      <div className="flex h-full">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          currentUserId={user?.id}
          onlineUsers={onlineUsers}
          pendingRequestCount={pendingRequestCount}
          onSelectConversation={(id) => {
            setActiveConversation(id)
            navigate(`/c/${id}`, { replace: true })
          }}
          onNewChat={() => setShowNewChat(true)}
          onHome={goHome}
          onSearchAgents={searchHomeAgents}
          onStartAgent={startAgentFromSearch}
        />

        {/* Chat area with branded background */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-950">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-800/60 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
            <button
              onClick={goHome}
              className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Avatar name={activeName} size="sm" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{activeName}</h3>
            {callActive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {muted ? 'Muted' : (callState === 'speaking' ? 'Speaking' : callState === 'thinking' ? 'Thinking' : 'Live')}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {!isConnected && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Reconnecting
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowCommandPalette(true)}
                title="Open command palette"
                className="hidden sm:inline-flex items-center rounded-lg px-1.5 py-1 text-[10px] font-medium text-gray-400 ring-1 ring-gray-200 transition-colors hover:text-brand-600 hover:ring-brand-300 dark:text-gray-500 dark:ring-gray-700 dark:hover:text-brand-400"
              >
                ⌘K
              </button>
              {micSupported && (
                <button
                  type="button"
                  data-testid="thread-mic-button"
                  onClick={toggleMic}
                  title={micState === 'connecting' || micState === 'listening' ? 'Stop listening' : micState === 'transcribing' ? 'Transcribing…' : 'Speak to Shizuha'}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                    micState === 'connecting' || micState === 'listening'
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
                type="button"
                data-testid="thread-speak-button"
                onClick={toggleSpeakReplies}
                title={speakReplies ? 'Voice replies on' : 'Voice replies off'}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                  speakReplies
                    ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400'
                    : 'bg-gray-100 text-gray-500 hover:bg-brand-50 hover:text-brand-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-brand-400'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              </button>
              {liveCallButton('thread-live-button', activeName)}
            </div>
          </div>

          {/* Messages + Input from @shizuha/chat */}
          <MessageList
            key={activeConversationId}
            conversationId={activeConversationId}
            messages={displayMessages}
            currentUserId={user?.id}
            typingUsers={activeConversationId ? typingUsers.get(activeConversationId) : undefined}
            hasMore={hasMore}
            isLoadingMore={isLoadingMessages}
            onLoadMore={loadMore}
            initialUnreadCount={activeInitialUnread}
          />
          <MessageInput
            onSend={sendMessage}
            disabled={!isConnected}
            placeholder={isConnected ? `Message ${activeName}...` : 'Connecting...'}
          />
        </div>
      </div>
    ) : (
    <div className="flex h-full">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        currentUserId={user?.id}
        onlineUsers={onlineUsers}
        pendingRequestCount={pendingRequestCount}
        onSelectConversation={(id) => {
          setActiveConversation(id)
          navigate(`/c/${id}`)
        }}
        onNewChat={() => setShowNewChat(true)}
        onSearchAgents={searchHomeAgents}
        onStartAgent={startAgentFromSearch}
      />

      {/* Main — same visual language as Hero. Scrolls: the live theater below
          grows with the org's activity (HIVE-602). */}
      <div
        data-testid="home-main-scroll"
        className="flex-1 flex flex-col items-center justify-start relative overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-950 dark:to-purple-950"
      >
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
          <HomeAgentPicker
            selectedUsername={effectiveHomeAgent}
            selectedLabel={selectedPicker?.displayName || effectiveHomeAgent}
            options={pickerOptions}
            onSelect={chooseHomeAgent}
            onSearch={searchHomeAgents}
          />
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
                data-testid="home-compose"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                }}
                onKeyDown={handleKeyDown}
                placeholder={effectiveHomeAgent ? `Ask ${selectedPicker?.displayName || effectiveHomeAgent}…` : 'Choose an agent above, then ask…'}
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
                    title={micState === 'connecting' || micState === 'listening' ? 'Stop listening' : micState === 'transcribing' ? 'Transcribing…' : 'Speak to Shizuha'}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                      micState === 'connecting' || micState === 'listening'
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
                {liveCallButton('home-live-button', selectedPicker?.displayName || effectiveHomeAgent || 'agent')}
                <button
                  type="button"
                  data-testid="home-send-button"
                  onClick={handleSubmit}
                  disabled={!inputValue.trim() || isSending || !effectiveHomeAgent}
                  className="w-9 h-9 rounded-xl bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              </div>
            </div>
            {sendError && (
              <p className="mt-2 text-center text-xs text-amber-700 dark:text-amber-300" data-testid="home-send-error">
                {sendError}
              </p>
            )}

            {/* Inline mini chat (operator 2026-07-11): rolling 2-3 line strip —
                talk with Shizuha without leaving the home page. */}
            {miniConvId && activeConversationId === miniConvId && (
              <MiniShizuhaChat
                messages={displayMessages}
                typingUsers={typingUsers}
                currentUserId={user?.id}
                isLoading={isLoadingMessages}
                agentLabel={selectedPicker?.displayName || effectiveHomeAgent || 'Agent'}
                onOpenFull={openFullFromMini}
                onClose={closeMiniChat}
                speakEnabled={speakReplies}
                onToggleSpeak={toggleSpeakReplies}
                callState={callState}
                callError={callError}
                onToggleCall={toggleCall}
                onRetryCall={retryCall}
                onDismissCallError={endCall}
              />
            )}
          </div>

          {/* CON-296: voice-call failure guidance when mini-chat isn't open yet */}
          {callFailed && callError?.message && !(miniConvId && activeConversationId === miniConvId) && (
            <div
              role="alert"
              data-testid="voice-call-error"
              className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <span className="flex-1 leading-relaxed">{callError.message}</span>
              {callError.canRetry ? (
                <button
                  type="button"
                  onClick={retryCall}
                  className="shrink-0 rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-amber-600"
                >
                  Retry
                </button>
              ) : (
                <button
                  type="button"
                  onClick={endCall}
                  className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800/80 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {/* HIVE-602: the live theater — agents visibly working, events
              streaming in, projects moving. The show. */}
          <LiveTheater feed={feedWidget} agents={agentsWidget} onPeekAgent={peekAgent} onPeekTask={peekTask} />


          {/* Org progress: is the org making progress and is anything badly
              wrong? Live resolution-rate trend, status distribution, bottleneck
              stages + a green/amber/red health read — org-scoped, own BFF poll,
              degrades independently (async-frontends doctrine). */}
          {orgs && orgs.length > 0 && effectiveProgressOrgId != null && (
            <div className="mt-8">
              <OrgProgressCharts
                orgs={orgs}
                orgId={effectiveProgressOrgId}
                onOrgChange={setProgressOrgId}
                range={progressRange}
                onRangeChange={setProgressRange}
              />
            </div>
          )}

          {/* HIVE-376: command-center dashboard — a concise, live, access-scoped
              view of the user's orgs / agents / work / money / alerts, hydrating
              independently from the HIVE-375 aggregation API. Chat stays the heart
              above; this is the "everything at a glance" surface below it. */}
          <div className="mt-8">
            <CommandCenterDashboard onPeekOrg={peekOrg} />
          </div>
        </div>
      </div>

    </div>
    )}

      <NewChatModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onSelectUser={handleNewChatUser}
        apiBase="/connect/api"
        getAuthToken={getAuthToken}
        currentUserId={user?.id}
        extraSearch={searchHomeAgents}
      />

      {(callActive || callFailed) && (
        <LiveVoiceOverlay
          agentLabel={voiceAgentLabel}
          callState={callState}
          muted={muted}
          lastHeard={lastHeard}
          lastReply={lastAgentReply}
          error={callError?.message || sendError || null}
          onToggleMute={toggleMute}
          onEnd={endCall}
          onRetry={callError?.canRetry ? retryCall : undefined}
        />
      )}

      {!threadOpen && <AppsDrawer isOpen={showApps} onClose={() => setShowApps(false)} />}

      {!threadOpen && peekStack.length > 0 && (
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
    </>
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
