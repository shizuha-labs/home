import { describe, expect, it } from 'vitest'
import {
  FRESH_AGENT_PERSIST_MS,
  alreadySpokePersist,
  isFreshAgentPersist,
  markPersistSpoken,
  messageSpeakKey,
  persistAgeMs,
  persistSpeakKeys,
  shouldPrimePersistedHistory,
} from './voicePersist'

const NOW = Date.parse('2026-08-17T08:53:47Z')

describe('voicePersist leftover policy', () => {
  it('prefers server id then client id', () => {
    expect(messageSpeakKey({ id: 'srv', client_message_id: 'cli' })).toBe('srv')
    expect(messageSpeakKey({ client_message_id: 'cli' })).toBe('cli')
    expect(messageSpeakKey({})).toBeNull()
  })

  it('treats client-id then server-id as the same spoken persist', () => {
    const spoken = new Set()
    const first = { client_message_id: 'cli', content: 'Here.' }
    const second = { id: 'srv', client_message_id: 'cli', content: 'Here.' }
    expect(persistSpeakKeys(first)).toEqual(['cli'])
    markPersistSpoken(spoken, first)
    expect(alreadySpokePersist(spoken, first)).toBe(true)
    expect(alreadySpokePersist(spoken, second)).toBe(true)
  })

  it('treats missing created_at as ancient', () => {
    expect(persistAgeMs({ content: 'hi' }, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(isFreshAgentPersist({ content: 'hi' }, NOW)).toBe(false)
  })

  it('treats a just-landed persist as fresh and hours-old as not', () => {
    expect(isFreshAgentPersist({ created_at: '2026-08-17T08:53:40Z' }, NOW)).toBe(true)
    expect(isFreshAgentPersist({ created_at: '2026-08-16T16:46:26Z' }, NOW)).toBe(false)
    expect(isFreshAgentPersist({
      created_at: new Date(NOW - FRESH_AGENT_PERSIST_MS - 1).toISOString(),
    }, NOW)).toBe(false)
  })

  it('primes history on first eligibility except a just-said agent reply', () => {
    const old = { id: 'a1', sender_id: 2, created_at: '2026-08-16T16:46:26Z' }
    const fresh = { id: 'a2', sender_id: 2, created_at: '2026-08-17T08:53:40Z' }
    const mine = { id: 'u1', sender_id: 1, created_at: '2026-08-17T08:53:40Z' }
    expect(shouldPrimePersistedHistory(null, old, 1, NOW)).toBe(true)
    expect(shouldPrimePersistedHistory(null, fresh, 1, NOW)).toBe(false)
    expect(shouldPrimePersistedHistory(null, mine, 1, NOW)).toBe(true)
    expect(shouldPrimePersistedHistory('a1', fresh, 1, NOW)).toBe(false)
  })
})
