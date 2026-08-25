import { describe, expect, it, beforeEach } from 'vitest'
import {
  agentConversations,
  conversationMatchesQuery,
  findAgentConversation,
  mergeAgentSearchHits,
  participantMatchesAgent,
  readHomeAgentPref,
  resolveHomeAgentUsername,
  suggestedHomeAgentUsername,
  writeHomeAgentPref,
} from '../hooks/useHomeAgentPreference'

describe('home agent preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not default regular users to the Admin Ops CoS or a fleet seat', () => {
    expect(suggestedHomeAgentUsername({ email: 'someone@example.com' })).toBe('')
  })

  it('defaults a non-CEO user to their own isolated personal agent (HIVE-2131)', () => {
    expect(suggestedHomeAgentUsername({ email: 'someone@example.com', id: 279 })).toBe('shizuha-279')
    expect(suggestedHomeAgentUsername({ email: 'mihir@example.com', id: 279 })).toBe('shizuha-279')
  })

  it('suggests ena for the CEO mailbox', () => {
    expect(suggestedHomeAgentUsername({ email: 'hothritik1@gmail.com' })).toBe('ena')
    expect(suggestedHomeAgentUsername({ email: 'hritik@shizuha.com' })).toBe('ena')
  })

  it('does not keep a retired Aya pick as the live default', () => {
    expect(resolveHomeAgentUsername('hina', { email: 'hothritik1@gmail.com' })).toBe('hina')
    expect(resolveHomeAgentUsername('aya', { email: 'hritik@shizuha.com' })).toBe('ena')
    expect(resolveHomeAgentUsername('yuna', { email: 'hothritik1@gmail.com' })).toBe('yuna')
  })

  it('does not send a regular or QA user to the operator Ena or fleet Yuna seat', () => {
    expect(resolveHomeAgentUsername('', { email: 'liveqa@shizuha.com', id: 555 })).toBe('shizuha-555')
    expect(resolveHomeAgentUsername('', { email: 'someone@example.com', id: 279 })).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('', { email: 'someone@example.com' })).toBe('')
    expect(resolveHomeAgentUsername('hina', { email: 'liveqa@shizuha.com', id: 555 })).toBe('hina')
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
