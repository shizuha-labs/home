import { describe, expect, it } from 'vitest'
import { mergeSessionUser, resolveCurrentUserId, userFromAccessToken } from './auth'

function fakeJwt(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `hdr.${b64}.sig`
}

describe('session user from ID JWT', () => {
  it('reads user_id from the access token, not id', () => {
    const token = fakeJwt({ user_id: 3, email: 'hothritik1@gmail.com', username: 'hritik' })
    expect(userFromAccessToken(token)).toEqual({
      id: 3,
      user_id: 3,
      email: 'hothritik1@gmail.com',
      username: 'hritik',
      first_name: '',
    })
  })

  it('fills missing localStorage id from the JWT so the operator is CEO', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3, email: 'hothritik1@gmail.com' }))
    const merged = mergeSessionUser({ display_name: 'Hritik Soni' }, tokenUser)
    expect(resolveCurrentUserId(merged)).toBe(3)
    expect(merged.email).toBe('hothritik1@gmail.com')
  })

  it('keeps a stored first_name ahead of an empty JWT claim', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3 }))
    const merged = mergeSessionUser({ id: 3, first_name: 'Hritik', username: 'hritik' }, tokenUser)
    expect(merged.first_name).toBe('Hritik')
    expect(merged.username).toBe('hritik')
  })

  it('lets the JWT user_id win over a stale shizuha_user.id', () => {
    const tokenUser = userFromAccessToken(fakeJwt({ user_id: 3, email: 'hothritik1@gmail.com' }))
    const merged = mergeSessionUser({ id: 1, display_name: 'Hritik Soni', email: 'hothritik1@gmail.com' }, tokenUser)
    expect(resolveCurrentUserId(merged)).toBe(3)
  })
})
