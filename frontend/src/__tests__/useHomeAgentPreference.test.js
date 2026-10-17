import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  agentConversations,
  conversationMatchesQuery,
  findAgentConversation,
  homeAgentDisplayName,
  isCeoHomeUser,
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
    vi.stubEnv("VITE_HOME_OPERATOR_USER_IDS", "3")
    vi.stubEnv("VITE_HOME_OPERATOR_AGENT", "ena")
  })

  it('does not default regular users to the Admin Ops CoS', () => {
    expect(suggestedHomeAgentUsername({ email: 'someone@example.com' })).toBe('')
  })

  it('does not infer operator authority from a mailbox', () => {
    expect(suggestedHomeAgentUsername({ email: 'operator@example.invalid' })).toBe('')
    expect(suggestedHomeAgentUsername({ email: 'operator-work@example.invalid' })).toBe('')
  })

  it('recognizes the CEO by username or id when email is missing', () => {
    expect(isCeoHomeUser({ username: 'operator-example' })).toBe(false)
    expect(isCeoHomeUser({ id: 3 })).toBe(true)
    expect(isCeoHomeUser({ user_id: 3 })).toBe(true)
    expect(isCeoHomeUser({ user_id: '3', display_name: 'Example Operator' })).toBe(true)
    expect(suggestedHomeAgentUsername({ id: 3, username: 'operator-example' })).toBe('ena')
    expect(suggestedHomeAgentUsername({ user_id: 3 })).toBe('ena')
    expect(resolveHomeAgentUsername('', { id: 3 })).toBe('ena')
    expect(personalHomeAgentUsername({ user_id: 279 })).toBe('shizuha-279')
  })

  it('binds customers to their own personal Shizuha, never fleet Yuna', () => {
    const mihir = { id: 279, email: 'customer@example.invalid' }
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
    const allowed = new Set(['shizuha-279', 'raunak-glm'])
    expect(resolveHomeAgentUsername('raunak-glm', mihir, { allowed })).toBe('raunak-glm')
    expect(resolveHomeAgentUsername('yuna', mihir, { allowed })).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('nami', mihir, { allowed })).toBe('shizuha-279')
    expect(resolveHomeAgentUsername('raunak-glm', mihir, { pending: true })).toBe('raunak-glm')
    expect(resolveHomeAgentUsername('yuna', mihir, { pending: true })).toBe('shizuha-279')
  })

  it('does not keep a retired Aya pick as the live default', () => {
    expect(resolveHomeAgentUsername('hina', { id: 3, email: 'operator@example.invalid' })).toBe('hina')
    expect(resolveHomeAgentUsername('aya', { id: 3, email: 'operator-work@example.invalid' })).toBe('ena')
    expect(resolveHomeAgentUsername('yuna', { id: 3, email: 'operator@example.invalid' })).toBe('yuna')
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

  it('treats participant_type agent and user_email as an agent seat', () => {
    const conversations = [
      {
        id: 'shizuha-dm',
        conversation_type: 'direct',
        participants: [
          { user_id: 3, user_name: 'Example Operator', user_email: 'operator@example.invalid' },
          { user_id: 24, user_name: 'Shizuha', user_email: 'shizuha@shizuha.com', participant_type: 'agent' },
        ],
      },
    ]
    const rows = agentConversations(conversations, 3, { email: 'operator@example.invalid' })
    expect(rows[0]?.username).toBe('Shizuha')
    expect(rows[0]?.displayName).toBe('Shizuha')
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
          { user_id: 1, user_name: 'Example' },
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


it('portable default has no privileged numeric account or concierge seat', () => {
  vi.stubEnv('VITE_HOME_OPERATOR_USER_IDS', '')
  vi.stubEnv('VITE_HOME_OPERATOR_AGENT', '')
  expect(isCeoHomeUser({ id: 3 })).toBe(false)
  expect(suggestedHomeAgentUsername({ id: 3 })).toBe('shizuha-3')
})
