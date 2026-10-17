import { describe, expect, it } from 'vitest'
import { mergeSessionUser, resolveCurrentUserId, userFromAccessToken } from './auth'

function fakeJwt(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `hdr.${b64}.sig`
}

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
