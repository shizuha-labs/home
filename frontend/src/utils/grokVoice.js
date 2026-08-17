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

export function normalizeVoiceText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Speaker-into-mic echo: her last line (or a close paraphrase) coming back as the user. */
export function isVoiceEchoText(heard, spoken) {
  const a = normalizeVoiceText(heard)
  const b = normalizeVoiceText(spoken)
  if (!a || !b) return false
  if (a === b || (a.length >= 8 && (b.includes(a) || a.includes(b)))) return true
  const aw = new Set(a.split(' ').filter((w) => w.length > 2))
  const bw = new Set(b.split(' ').filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return false
  let n = 0
  for (const w of aw) if (bw.has(w)) n += 1
  return n / Math.min(aw.size, bw.size) >= 0.45
}

/** Mic stays down while she talks and until playback has drained. */
export function shouldHoldMicWhileSpeaking({ speaking = false, remainingMs = 0 } = {}) {
  return Boolean(speaking) || Number(remainingMs) > 0
}

export function historyToVoiceItems(messages, userId, limit = 12) {
  const list = Array.isArray(messages) ? messages : []
  const raw = []
  for (const msg of list.slice(-limit)) {
    const text = String(msg?.content || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    raw.push({
      role: msg.sender_id === userId ? 'user' : 'assistant',
      text: text.slice(0, 1200),
    })
  }
  const out = []
  for (const item of raw) {
    if (item.role === 'user') {
      const prev = [...out].reverse().find((row) => row.role === 'assistant')
      if (prev && isVoiceEchoText(item.text, prev.text)) continue
    }
    out.push(item)
  }
  return out
}
