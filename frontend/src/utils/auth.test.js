import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleUnauthorized, mergeSessionUser, resolveCurrentUserId, userFromAccessToken } from './auth'

function fakeJwt(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `hdr.${b64}.sig`
}

describe('handleUnauthorized on the public landing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('does not clear the session or navigate when a widget 401s on /', () => {
    localStorage.setItem('shizuha_access_token', 'live-token')
    vi.stubGlobal('location', { pathname: '/', search: '', hash: '', assign: vi.fn() })
    const navigated = handleUnauthorized({ status: 401 })
    expect(navigated).toBe(false)
    expect(localStorage.getItem('shizuha_access_token')).toBe('live-token')
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('still expires and redirects when a protected route 401s', () => {
    localStorage.setItem('shizuha_access_token', 'live-token')
    const assign = vi.fn()
    vi.stubGlobal('location', { pathname: '/c/1', search: '', hash: '', assign })
    expect(handleUnauthorized({ status: 401 })).toBe(true)
    expect(localStorage.getItem('shizuha_access_token')).toBeNull()
    expect(assign).toHaveBeenCalledWith('/id/login?continue=%2Fc%2F1')
  })
})

describe('session user from ID JWT', () => {
  it('returns null when there is no access token (logged-out public pages)', () => {
    expect(userFromAccessToken(null)).toBeNull()
    expect(userFromAccessToken('')).toBeNull()
    expect(userFromAccessToken()).toBeNull()
  })

  it('reads user_id from the access token, not id', () => {
    const token = fakeJwt({ user_id: 3, email: 'operator@example.invalid', username: 'operator-example' })
    expect(userFromAccessToken(token)).toEqual({
      id: 3,
      user_id: 3,
      email: 'operator@example.invalid',
      username: 'operator-example',
      first_name: '',
    })
  })

  it('fills missing localStorage id from the JWT so the operator is CEO', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3, email: 'operator@example.invalid' }))
    const merged = mergeSessionUser({ display_name: 'Example Operator' }, tokenUser)
    expect(resolveCurrentUserId(merged)).toBe(3)
    expect(merged.email).toBe('operator@example.invalid')
  })

  it('keeps a stored first_name ahead of an empty JWT claim', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3 }))
    const merged = mergeSessionUser({ id: 3, first_name: 'Example', username: 'operator-example' }, tokenUser)
    expect(merged.first_name).toBe('Example')
    expect(merged.username).toBe('operator-example')
  })

  it('lets the JWT user_id win over a stale shizuha_user.id', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3, email: 'operator@example.invalid' }))
    const merged = mergeSessionUser({ id: 1, display_name: 'Example Operator', email: 'operator@example.invalid' }, tokenUser)
    expect(resolveCurrentUserId(merged)).toBe(3)
  })
})
