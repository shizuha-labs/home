import { createContext, useContext, useState, useEffect } from 'react'
import {
  ACCESS_TOKEN_KEY,
  USER_KEY,
  clearAuthStorage,
  expireSessionAndRedirect,
  isAccessTokenExpired,
  mergeSessionUser,
  refreshSession,
  userFromAccessToken,
} from '../utils/auth'

const AuthContext = createContext(null)

/**
 * Read-only AuthProvider for shizuha-home
 * Only reads auth state from localStorage - does not perform login/logout
 * Login/logout is handled by shizuha-id
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY)
      const storedUser = localStorage.getItem(USER_KEY)

      if (accessToken && isAccessTokenExpired(accessToken)) {
        // Try a silent refresh before nuking the session — a valid refresh
        // token means the user never has to see the login page.
        const refreshed = await refreshSession()
        if (!refreshed) {
          expireSessionAndRedirect()
          setUser(null)
          setIsAuthenticated(false)
          setIsLoading(false)
          return
        }
      }
      const token = localStorage.getItem(ACCESS_TOKEN_KEY) || accessToken
      const tokenUser = userFromAccessToken(token)
      let stored = null
      if (storedUser) {
        try {
          stored = JSON.parse(storedUser)
        } catch (error) {
          console.error('Failed to parse stored user:', error)
        }
      }
      const merged = mergeSessionUser(stored, tokenUser)
      if (token && merged) {
        setUser(merged)
        setIsAuthenticated(true)
        if (
          !stored?.username
          || !stored?.first_name
          || stored?.id == null
          || Number(stored.id) !== Number(merged.id)
        ) {
          fetch('/id/api/auth/user/', { headers: { Authorization: `Bearer ${token}` } })
            .then((res) => (res.ok ? res.json() : null))
            .then((fresh) => {
              if (!fresh) return
              const next = mergeSessionUser(fresh, userFromAccessToken())
              if (!next) return
              try { localStorage.setItem(USER_KEY, JSON.stringify(next)) } catch { /* private mode */ }
              setUser(next)
            })
            .catch(() => {})
        }
      } else {
        setUser(null)
        setIsAuthenticated(false)
      }
      setIsLoading(false)
    }

    initAuth()
  }, [])

  // Silent claim refresh: on load + every 10 minutes. The id refresh endpoint
  // recomputes enabled_services, so services granted AFTER login (connect,
  // hive, ...) reach an already-open session — no manual re-login, no
  // permanent "Restricted" chips from a stale token.
  useEffect(() => {
    refreshSession()
    const t = setInterval(() => refreshSession(), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Listen for storage events (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (
        e.type === 'shizuha-auth-cleared'
        || e.type === 'shizuha-auth-refreshed'
        || e.key === ACCESS_TOKEN_KEY
        || e.key === USER_KEY
      ) {
        const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY)
        const storedUser = localStorage.getItem(USER_KEY)

        if (accessToken && isAccessTokenExpired(accessToken)) {
          expireSessionAndRedirect()
          setUser(null)
          setIsAuthenticated(false)
        } else if (accessToken) {
          let stored = null
          if (storedUser) {
            try { stored = JSON.parse(storedUser) } catch { stored = null }
          }
          const merged = mergeSessionUser(stored, userFromAccessToken(accessToken))
          if (merged) {
            setUser(merged)
            setIsAuthenticated(true)
          } else {
            setUser(null)
            setIsAuthenticated(false)
          }
        } else {
          setUser(null)
          setIsAuthenticated(false)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('shizuha-auth-cleared', handleStorageChange)
    window.addEventListener('shizuha-auth-refreshed', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('shizuha-auth-cleared', handleStorageChange)
      window.removeEventListener('shizuha-auth-refreshed', handleStorageChange)
    }
  }, [])

  const value = {
    user,
    isLoading,
    isAuthenticated,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
