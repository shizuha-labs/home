/** Treat Connect's numeric fallback ("User 735") as a missing name. */

export function isPlaceholderName(name, userId) {
  const text = String(name || '').trim()
  if (!text) return true
  if (userId == null || userId === '') return /^user[_\s-]\d+$/i.test(text)
  return new RegExp(`^user[_\\s-]${userId}$`, 'i').test(text)
}

export function conversationPeerName(conv, currentUserId) {
  if (!conv) return 'Chat'
  if (conv.conversation_type === 'group') return conv.name || 'Group'
  const other = (conv.participants || []).find(
    (p) => p.user_id !== currentUserId && !p.has_left,
  )
  if (other && !isPlaceholderName(other.user_name, other.user_id)) {
    return other.user_name
  }
  const fromList = (conv.participant_names || []).find(
    (n) => n && !isPlaceholderName(n, other?.user_id),
  )
  if (fromList) return fromList
  const email = other?.user_email || other?.email || ''
  if (email.includes('@')) return email.split('@', 1)[0]
  return other?.username || 'Chat'
}
