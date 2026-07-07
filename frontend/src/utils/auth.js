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

export function handleUnauthorized(response) {
  if (response?.status === 401) {
    expireSessionAndRedirect()
    return true
  }
  return false
}
