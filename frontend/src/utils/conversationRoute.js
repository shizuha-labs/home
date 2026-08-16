/** Thread id from `/c/:id`. Independent of useParams so the layout shell
 *  (parent of <Outlet />) can read the URL without remounting ChatHome. */
export function conversationIdFromPath(pathname = '') {
  const path = String(pathname || '').split(/[?#]/)[0]
  const match = path.match(/^\/c\/([^/]+)\/?$/)
  return match?.[1] || null
}

export function isHomeAppPath(pathname = '') {
  const path = String(pathname || '/').split('?')[0] || '/'
  return path === '/' || path === '/c' || path.startsWith('/c/')
}

/**
 * Keep the Connect thread (and therefore Live) across `/` ↔ `/c/:id`.
 * Mid-call, leaving a thread URL parks that conversation as the home mini-chat
 * instead of clearing it — a full document load used to kill the session.
 */
export function nextThreadAfterRouteChange({
  urlConversationId = null,
  activeConversationId = null,
  miniConvId = null,
  callState = 'idle',
} = {}) {
  if (urlConversationId) {
    if (urlConversationId !== activeConversationId) {
      return { activeConversationId: urlConversationId, miniConvId: null }
    }
    return { activeConversationId, miniConvId }
  }
  if (!activeConversationId || activeConversationId === miniConvId) {
    return { activeConversationId, miniConvId }
  }
  if (callState && callState !== 'idle') {
    return { activeConversationId, miniConvId: activeConversationId }
  }
  return { activeConversationId: null, miniConvId }
}
