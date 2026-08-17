/**
 * Persist leftover TTS policy.
 *
 * Start Live / voice-replies-on must not replay the last hours-old
 * agent turn. Speak leftover only when that persist just landed.
 */
export const FRESH_AGENT_PERSIST_MS = 20_000

export function messageSpeakKey(message) {
  return message?.id || message?.client_message_id || null
}

export function persistAgeMs(message, now = Date.now()) {
  const ts = Date.parse(message?.created_at || '')
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY
  return now - ts
}

export function isFreshAgentPersist(message, now = Date.now(), windowMs = FRESH_AGENT_PERSIST_MS) {
  return persistAgeMs(message, now) <= windowMs
}

/** First time this thread is speak-eligible: absorb history unless she just said it. */
export function shouldPrimePersistedHistory(lastSpokenId, lastMessage, userId, now = Date.now()) {
  if (lastSpokenId != null) return false
  if (!lastMessage) return false
  if (lastMessage.sender_id === userId) return true
  return !isFreshAgentPersist(lastMessage, now)
}
