import { describe, expect, it, beforeEach } from 'vitest'
import {
  agentConversations,
  findAgentConversation,
  participantMatchesAgent,
  readHomeAgentPref,
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

  it('suggests hina for the CEO mailbox', () => {
    expect(suggestedHomeAgentUsername({ email: 'hothritik1@gmail.com' })).toBe('hina')
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
})
