import { describe, expect, it } from 'vitest'
import {
  conversationPeerUsername,
  findAgentByUsername,
  historyToVoiceItems,
  isGrokVoiceOmniModel,
  isVoiceEchoText,
  liveVoiceAgent,
  shouldHoldMicWhileSpeaking,
  stripGrokVoicePrefix,
} from '../utils/grokVoice'

describe('isGrokVoiceOmniModel', () => {
  it('matches the Hina seat and aliases', () => {
    expect(isGrokVoiceOmniModel('cortex/grok-voice-think-fast-2.0')).toBe(true)
    expect(isGrokVoiceOmniModel('grok-voice-latest')).toBe(true)
    expect(isGrokVoiceOmniModel('xai/grok-voice-think-fast-2.0')).toBe(true)
  })

  it('does not match Ena or other chat models', () => {
    expect(isGrokVoiceOmniModel('cortex/grok-4.6')).toBe(false)
    expect(isGrokVoiceOmniModel('grok-4')).toBe(false)
    expect(isGrokVoiceOmniModel('')).toBe(false)
  })
})

describe('liveVoiceAgent', () => {
  const agents = [
    { username: 'ena', model: 'cortex/grok-4.6' },
    { username: 'hina', model: 'cortex/grok-voice-think-fast-2.0' },
  ]

  it('prefers the open thread peer over the homepage picker', () => {
    const conv = {
      participants: [
        { user_id: 1, username: 'hritik' },
        { user_id: 698, username: 'hina' },
      ],
    }
    const agent = liveVoiceAgent(agents, conv, 1, 'ena')
    expect(agent.username).toBe('hina')
    expect(isGrokVoiceOmniModel(agent.model)).toBe(true)
  })

  it('falls back to the picker when the thread has no peer', () => {
    expect(findAgentByUsername(agents, 'ena').model).toContain('grok-4.6')
    expect(conversationPeerUsername({ participants: [] }, 1)).toBe('')
    expect(stripGrokVoicePrefix('cortex/xai/grok-voice-latest')).toBe('grok-voice-latest')
  })
})

describe('historyToVoiceItems', () => {
  it('keeps the last turns as user/assistant text', () => {
    const items = historyToVoiceItems([
      { sender_id: 1, content: 'Hi' },
      { sender_id: 698, content: 'Hello' },
    ], 1)
    expect(items).toEqual([
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello' },
    ])
  })

  it('drops a user turn that is her previous line leaking back in', () => {
    const items = historyToVoiceItems([
      { sender_id: 1, content: 'Hi, what is up?' },
      { sender_id: 698, content: 'Hi. Queue\'s clean. How can I help?' },
      { sender_id: 1, content: 'Hi. Queue\'s clean. How can I help?' },
    ], 1)
    expect(items).toEqual([
      { role: 'user', text: 'Hi, what is up?' },
      { role: 'assistant', text: 'Hi. Queue\'s clean. How can I help?' },
    ])
  })
})

describe('voice echo hold', () => {
  it('treats her own last sentence as echo', () => {
    expect(isVoiceEchoText(
      "Hi. Queue's clean. How can I help?",
      "Hi. Queue's clean. How can I help?",
    )).toBe(true)
    expect(isVoiceEchoText('What is on my queue?', 'Hi. Queue\'s clean. How can I help?')).toBe(false)
  })

  it('holds the mic while she is speaking or audio is still draining', () => {
    expect(shouldHoldMicWhileSpeaking({ speaking: true, remainingMs: 0 })).toBe(true)
    expect(shouldHoldMicWhileSpeaking({ speaking: false, remainingMs: 400 })).toBe(true)
    expect(shouldHoldMicWhileSpeaking({ speaking: false, remainingMs: 0 })).toBe(false)
  })
})
