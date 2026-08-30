/**
 * Per-user default home chat agent.
 *
 * The homepage used to hardcode the CoS agent named "Shizuha" (Admin Ops).
 * That seat is governance/escalation, not a personal or customer concierge.
 * Preference is local until ID/Connect grows a profile field.
 */
export const HOME_AGENT_PREF_KEY = 'shizuha_home_agent'

export function readHomeAgentPref() {
  try {
    return String(localStorage.getItem(HOME_AGENT_PREF_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function writeHomeAgentPref(username) {
  const value = String(username || '').trim()
  try {
    if (value) localStorage.setItem(HOME_AGENT_PREF_KEY, value)
    else localStorage.removeItem(HOME_AGENT_PREF_KEY)
  } catch {
    /* private mode */
  }
  return value
}

/** Grok-build seats we stopped for realtime; never auto-select them. */
export const RETIRED_HOME_AGENTS = new Set(['aya'])

/** CEO Office talk seats. Customers must never land on these. */
export const ORG_HOME_AGENTS = new Set(['yuna', 'hina', 'ena', 'aya'])

const CEO_HOME_EMAILS = new Set(['hothritik1@gmail.com', 'hritik@shizuha.com'])

export function isCeoHomeUser(user) {
  return CEO_HOME_EMAILS.has(String(user?.email || '').toLowerCase())
}

export function isPersonalHomeAgentUsername(username) {
  return /^shizuha-\d+$/.test(String(username || '').trim().toLowerCase())
}

export function personalHomeAgentUsername(user) {
  const id = Number(user?.id)
  if (!Number.isInteger(id) || id <= 0) return ''
  return `shizuha-${id}`
}

export function homeAgentDisplayName(username, fallback) {
  if (isPersonalHomeAgentUsername(username)) return 'Shizuha'
  return fallback || username || ''
}

/** CEO default is the Grok/SCLI talk seat (Ena). Everyone else gets their Shizuha. */
export function suggestedHomeAgentUsername(user) {
  if (isCeoHomeUser(user)) return 'ena'
  return personalHomeAgentUsername(user)
}

/** Never fall through to an org seat. Empty until the caller's id is known. */
export const DEFAULT_HOME_AGENT = ''

export function isForbiddenHomeAgentUsername(username, user) {
  const raw = String(username || '').trim().toLowerCase()
  if (!raw) return true
  if (RETIRED_HOME_AGENTS.has(raw)) return true
  if (isCeoHomeUser(user)) return false
  if (ORG_HOME_AGENTS.has(raw)) return true
  if (isPersonalHomeAgentUsername(raw) && raw !== personalHomeAgentUsername(user)) return true
  return false
}

/** Prefer stored pick only when it is this caller's agent. Customers stay on Shizuha. */
export function resolveHomeAgentUsername(preferred, user) {
  const suggested = suggestedHomeAgentUsername(user)
  if (!isCeoHomeUser(user)) return suggested
  const raw = String(preferred || '').trim().toLowerCase()
  if (raw && !RETIRED_HOME_AGENTS.has(raw)) return raw
  return suggested || DEFAULT_HOME_AGENT
}

export function participantMatchesAgent(participant, username) {
  if (!participant || !username) return false
  const want = String(username).toLowerCase()
  const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9@.]/g, '')
  const wantCompact = compact(want)
  const names = [
    participant.user_name,
    participant.username,
    participant.name,
    participant.email,
    participant.display_name,
  ]
  return names.some((n) => {
    const s = String(n || '').toLowerCase()
    return s === want
      || s.split('@')[0] === want
      || compact(s) === wantCompact
  })
}

export function findAgentConversation(conversations, username) {
  if (!username || !Array.isArray(conversations)) return null
  return conversations.find((c) =>
    c?.conversation_type !== 'group'
    && (c.participants || []).some((p) => participantMatchesAgent(p, username)),
  ) || null
}

export function conversationMatchesQuery(conversation, query, currentUserId) {
  const q = String(query || '').trim().toLowerCase()
  if (!q || !conversation) return true
  const other = (conversation.participants || []).find((p) => p.user_id !== currentUserId)
  const blob = [
    conversation.name,
    conversation.last_message_preview,
    ...(conversation.participant_names || []),
    other?.user_name,
    other?.username,
    other?.name,
    other?.email,
  ].map((v) => String(v || '').toLowerCase()).join(' ')
  return blob.includes(q)
}

export function mergeAgentSearchHits(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const row of list || []) {
      const username = String(row?.username || '').trim()
      const userId = row?.userId || row?.user_id || row?.id
      if (!username || seen.has(username.toLowerCase())) continue
      seen.add(username.toLowerCase())
      out.push({
        userId: userId || null,
        username,
        displayName: row.displayName || row.display_name || row.first_name || username,
        email: row.email || `${username}@shizuha.com`,
      })
    }
  }
  return out
}

export function agentConversations(conversations, currentUserId) {
  if (!Array.isArray(conversations)) return []
  const seen = new Set()
  const out = []
  for (const conv of conversations) {
    if (conv?.conversation_type === 'group') continue
    const other = (conv.participants || []).find((p) => p.user_id !== currentUserId)
    const looksAgent = Boolean(
      other?.agent_role
      || other?.is_agent
      || String(other?.email || '').endsWith('@shizuha.com')
      || String(other?.email || '').includes('@agents.'),
    )
    if (!other || !looksAgent) continue
    const username = String(other.username || other.user_name || '').trim()
    if (!username || seen.has(username.toLowerCase())) continue
    seen.add(username.toLowerCase())
    out.push({
      username,
      displayName: other.user_name || other.name || username,
      userId: other.user_id,
      conversationId: conv.id,
    })
  }
  return out
}
