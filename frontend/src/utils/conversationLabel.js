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

export function conversationPeer(conv, currentUserId) {
  if (!conv || currentUserId == null || currentUserId === '') return null
  return (conv.participants || []).find(
    (p) => !sameUserId(p.user_id, currentUserId) && !p.has_left,
  ) || null
}

export function isSelfDirectConversation(conv, currentUserId) {
  if (!conv || conv.conversation_type === 'group') return false
  if (currentUserId == null || currentUserId === '') return false
  const active = (conv.participants || []).filter((p) => !p.has_left)
  if (active.length === 0) return false
  return active.every((p) => sameUserId(p.user_id, currentUserId))
}

export function conversationPeerName(conv, currentUserId) {
  if (!conv) return 'Chat'
  if (conv.conversation_type === 'group') return conv.name || 'Group'
  const other = conversationPeer(conv, currentUserId)
  if (other && !isPlaceholderName(other.user_name, other.user_id)) {
    return other.user_name
  }
  const selfName = (conv.participants || []).find(
    (p) => sameUserId(p.user_id, currentUserId),
  )?.user_name
  const fromList = (conv.participant_names || []).find(
    (n) => n && n !== selfName && !isPlaceholderName(n, other?.user_id),
  )
  if (fromList) return fromList
  const email = other?.user_email || other?.email || ''
  if (email.includes('@')) return email.split('@', 1)[0]
  return other?.username || 'Chat'
}
