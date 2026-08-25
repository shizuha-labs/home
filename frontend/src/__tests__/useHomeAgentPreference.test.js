import { describe, expect, it, beforeEach } from 'vitest'
import {
  agentConversations,
  conversationMatchesQuery,
  findAgentConversation,
  homeAgentDisplayName,
  isForbiddenHomeAgentUsername,
  mergeAgentSearchHits,
  participantMatchesAgent,
  personalHomeAgentUsername,
  readHomeAgentPref,
  resolveHomeAgentUsername,
  suggestedHomeAgentUsername,
  writeHomeAgentPref,
} from '../hooks/useHomeAgentPreference'

describe('home agent preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not default regular users to the Admin Ops CoS', () => {
    expect(suggestedHomeAgentUsername({ email: 'someone@example.com' })).toBe('')
  })

  it('suggests ena for the CEO mailbox', () => {
    expect(suggestedHomeAgentUsername({ email: 'hothritik1@gmail.com' })).toBe('ena')
    expect(suggestedHomeAgentUsername({ email: 'hritik@shizuha.com' })).toBe('ena')
  })

  it('binds customers to their own personal Shizuha, never fleet Yuna', () => {
    const mihir = { id: 279, email: 'mihirgates@hotmail.com' }
    expect(personalHomeAgentUsername(mihir)).toBe('shizuha-279')
    expect(suggestedHomeAgentUsername(mihir)).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('', mihir)).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('yuna', mihir)).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('hina', mihir)).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('shizuha-115', mihir)).toBe('shizuha-279')
    expect(homeAgentDisplayName('shizuha-279')).toBe('Shizuha')
    expect(isForbiddenHomeAgentUsername('yuna', mihir)).toBe(true)
    expect(isForbiddenHomeAgentUsername('shizuha-115', mihir)).toBe(true)
    expect(isForbiddenHomeAgentUsername('shizuha-279', mihir)).toBe(false)
  })

  it('does not keep a retired Aya pick as the live default', () => {
    expect(resolveHomeAgentUsername('hina', { email: 'hothritik1@gmail.com' })).toBe('hina')
    expect(resolveHomeAgentUsername('aya', { email: 'hritik@shizuha.com' })).toBe('ena')
    expect(resolveHomeAgentUsername('yuna', { email: 'hothritik1@gmail.com' })).toBe('yuna')
  })

  it('does not send a regular or QA user to the operator Ena or Yuna seat', () => {
    expect(resolveHomeAgentUsername('', { id: 739, email: 'liveqa@shizuha.com' })).toBe('shizuha-739')
    expect(resolveHomeAgentUsername('yuna', { email: 'someone@example.com' })).toBe('')
    expect(resolveHomeAgentUsername('hina', { id: 739, email: 'liveqa@shizuha.com' })).toBe('shizuha-739')
  })

  it('round-trips localStorage', () => {
    writeHomeAgentPref('cora')
    expect(readHomeAgentPref()).toBe('cora')
  })

  it('matches a conversation by username, not any agent_role', () => {
    const conversations = [
      {
        id: 'a',
        conversation_type: 'direct',
        participants: [{ user_name: 'Shizuha', username: 'shizuha', agent_role: true }],
      },
      {
        id: 'b',
        conversation_type: 'direct',
        participants: [{ user_name: 'Cora', username: 'cora', agent_role: true }],
      },
    ]
    expect(findAgentConversation(conversations, 'cora')?.id).toBe('b')
    expect(participantMatchesAgent(conversations[0].participants[0], 'Shizuha')).toBe(true)
    expect(participantMatchesAgent({ user_name: 'Ena QA', email: 'enaqa@shizuha.com' }, 'enaqa')).toBe(true)
  })

  it('lists prior agent DMs for the picker', () => {
    const listed = agentConversations([
      {
        id: 'c1',
        conversation_type: 'direct',
        participants: [
          { user_id: 1, user_name: 'Hritik' },
          { user_id: 9, user_name: 'Cora', username: 'cora', agent_role: true, email: 'cora@shizuha.com' },
        ],
      },
    ], 1)
    expect(listed.map((a) => a.username)).toEqual(['cora'])
  })

  it('matches a conversation search against username or display name', () => {
    const conv = {
      id: 'c1',
      conversation_type: 'direct',
      participant_names: ['Hina'],
      participants: [{ user_id: 2, user_name: 'Hina', username: 'hina' }],
    }
    expect(conversationMatchesQuery(conv, 'hina', 1)).toBe(true)
    expect(conversationMatchesQuery(conv, 'cora', 1)).toBe(false)
  })

  it('merges hive/id/connect hits without dropping hina', () => {
    const merged = mergeAgentSearchHits(
      [{ username: 'hina', displayName: 'Hina', userId: 42 }],
      [{ username: 'hina', displayName: 'Hina duplicate' }, { username: 'cora', userId: 9 }],
    )
    expect(merged.map((row) => row.username)).toEqual(['hina', 'cora'])
    expect(merged[0].userId).toBe(42)
  })
})
