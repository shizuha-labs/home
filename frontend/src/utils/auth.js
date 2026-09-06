export const ACCESS_TOKEN_KEY = 'shizuha_access_token'
export const REFRESH_TOKEN_KEY = 'shizuha_refresh_token'
export const USER_KEY = 'shizuha_user'

export function getAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

function decodeJwtPayload(token) {
  const [, payload] = token.split('.')
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(normalized))
  } catch {
    return null
  }
}

/** ID JWT claims `user_id` (not `id`). Home must not depend on shizuha_user.shape. */
export function userFromAccessToken(token = getAccessToken()) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload !== 'object') return null
  const raw = payload.user_id ?? payload.sub ?? payload.id
  const n = Number(raw)
  const id = Number.isInteger(n) && n > 0 ? n : null
  if (!id && !payload.email && !payload.username) return null
  return {
    id,
    user_id: id,
    email: payload.email || '',
    username: payload.username || payload.preferred_username || '',
    first_name: payload.first_name || payload.given_name || '',
  }
}

export function resolveCurrentUserId(user) {
  const n = Number(user?.id ?? user?.user_id)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function mergeSessionUser(stored, tokenUser) {
  if (!stored && !tokenUser) return null
  const merged = { ...(tokenUser || {}), ...(stored || {}) }
  // The access token is the live identity. A stale shizuha_user.id (often 1)
  // must not win — that made the operator's Shizuha DM label as "Hritik Soni".
  const id = resolveCurrentUserId(tokenUser) || resolveCurrentUserId(merged)
  if (id != null) {
    merged.id = id
    merged.user_id = id
  }
  if (tokenUser?.email) merged.email = merged.email || tokenUser.email
  if (tokenUser?.username) merged.username = merged.username || tokenUser.username
  if (!merged.first_name && tokenUser?.first_name) merged.first_name = tokenUser.first_name
  return merged
}

export function isAccessTokenExpired(token = getAccessToken()) {
  if (!token) return true
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 <= Date.now() + 30_000
}

export function clearAuthStorage() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.dispatchEvent(new Event('shizuha-auth-cleared'))
  } catch {
    // Nothing useful to do; callers will still redirect.
  }
}

export function redirectToLogin() {
  const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.assign(`/id/login?continue=${encodeURIComponent(returnUrl)}`)
}

export function expireSessionAndRedirect() {
  clearAuthStorage()
  redirectToLogin()
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

let refreshInFlight = null

/**
 * Silent session refresh against shizuha-id. Besides extending expiry, the
 * refresh endpoint RECOMPUTES enabled_services — so services granted after
 * login (e.g. connect for the personal agent) reach this session without a
 * manual re-login. Without this, a stale token shows "Restricted" forever.
 * Returns true when a fresh token pair was stored.
 */
export async function refreshSession() {
  const refresh = getRefreshToken()
  if (!refresh) return false
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/id/api/auth/refresh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!res.ok) return false
      const data = await res.json()
      if (!data?.access) return false
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access)
      if (data.refresh) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh)
      window.dispatchEvent(new Event('shizuha-auth-refreshed'))
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export function handleUnauthorized(response) {
  if (response?.status === 401) {
    expireSessionAndRedirect()
    return true
  }
  return false
}
