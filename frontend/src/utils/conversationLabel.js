/** Treat Connect's numeric fallback ("User 735") as a missing name. */

export function isPlaceholderName(name, userId) {
  const text = String(name || '').trim()
  if (!text) return true
  if (userId == null || userId === '') return /^user[_\s-]\d+$/i.test(text)
  return new RegExp(`^user[_\\s-]${userId}$`, 'i').test(text)
}

/** JWT / localStorage ids are sometimes strings; Connect user_id is a number. */
export function sameUserId(a, b) {
  if (a == null || b == null || a === '' || b === '') return false
  return String(a) === String(b)
}

export function isCurrentUserParticipant(participant, currentUserId, currentUser) {
  if (!participant) return false
  if (sameUserId(participant.user_id, currentUserId)) return true
  const email = String(currentUser?.email || '').trim().toLowerCase()
  if (email && String(participant.user_email || participant.email || '').trim().toLowerCase() === email) {
    return true
  }
  return false
}

export function conversationPeer(conv, currentUserId, currentUser) {
  if (!conv) return null
  const hasIdentity = (currentUserId != null && currentUserId !== '') || Boolean(currentUser?.email)
  if (!hasIdentity) return null
  return (conv.participants || []).find(
    (p) => !p.has_left && !isCurrentUserParticipant(p, currentUserId, currentUser),
  ) || null
}

export function isSelfDirectConversation(conv, currentUserId, currentUser) {
  if (!conv || conv.conversation_type === 'group') return false
  const hasIdentity = (currentUserId != null && currentUserId !== '') || Boolean(currentUser?.email)
  if (!hasIdentity) return false
  const active = (conv.participants || []).filter((p) => !p.has_left)
  if (active.length === 0) return false
  return active.every((p) => isCurrentUserParticipant(p, currentUserId, currentUser))
}

/** Inbox rows are recency-equal: no hive/openclaw/hermes pin, no empty-thread boost. */
export function conversationBelongsInInbox(conv, currentUserId, activeConversationId, currentUser) {
  if (!conv) return false
  if (isSelfDirectConversation(conv, currentUserId, currentUser)) return false
  if (activeConversationId && conv.id === activeConversationId) return true
  return Boolean(conv.last_message_at) || Number(conv.message_count || 0) > 0
}

export function conversationPeerName(conv, currentUserId, currentUser) {
  if (!conv) return 'Chat'
  if (conv.conversation_type === 'group') return conv.name || 'Group'
  const other = conversationPeer(conv, currentUserId, currentUser)
  if (other && !isPlaceholderName(other.user_name, other.user_id)) {
    return other.user_name
  }
  const selfName = (conv.participants || []).find(
    (p) => isCurrentUserParticipant(p, currentUserId, currentUser),
  )?.user_name
  const fromList = (conv.participant_names || []).find(
    (n) => n && n !== selfName && !isPlaceholderName(n, other?.user_id),
  )
  if (fromList) return fromList
  const email = other?.user_email || other?.email || ''
  if (email.includes('@')) return email.split('@', 1)[0]
  return other?.username || 'Chat'
}
