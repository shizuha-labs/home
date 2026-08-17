/** Grok Voice Think Fast (and later grok-voice-*) — native speech-to-speech. */

export function stripGrokVoicePrefix(model) {
  let bare = String(model || '').trim().toLowerCase()
  for (let i = 0; i < 4; i += 1) {
    const next = bare.replace(/^(cortex\/)+|(^xai\/)|(^xai:)/, '')
    if (next === bare) break
    bare = next
  }
  return bare
}

export function isGrokVoiceOmniModel(model) {
  return stripGrokVoicePrefix(model).startsWith('grok-voice')
}

export function conversationPeerUsername(conversation, currentUserId) {
  const other = (conversation?.participants || []).find(
    (p) => p.user_id !== currentUserId && !p.has_left,
  )
  const raw = other?.username || other?.user_name || other?.email || ''
  return String(raw).trim().split('@')[0].toLowerCase()
}

export function findAgentByUsername(agents, username) {
  const want = String(username || '').trim().toLowerCase()
  if (!want) return null
  return (agents || []).find((row) => {
    const names = [row?.username, row?.name, row?.email]
    return names.some((n) => String(n || '').trim().split('@')[0].toLowerCase() === want)
  }) || null
}

export function liveVoiceAgent(agents, conversation, currentUserId, fallbackUsername) {
  const peer = conversationPeerUsername(conversation, currentUserId)
  return findAgentByUsername(agents, peer) || findAgentByUsername(agents, fallbackUsername)
}

export function realtimeVoiceUrl() {
  if (typeof window === 'undefined') return '/voice/api/realtime/stream'
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/voice/api/realtime/stream`
}

export function historyToVoiceItems(messages, userId, limit = 12) {
  const list = Array.isArray(messages) ? messages : []
  const out = []
  for (const msg of list.slice(-limit)) {
    const text = String(msg?.content || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    out.push({
      role: msg.sender_id === userId ? 'user' : 'assistant',
      text: text.slice(0, 1200),
    })
  }
  return out
}
