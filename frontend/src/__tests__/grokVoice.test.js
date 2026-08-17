import { afterEach, describe, expect, it } from 'vitest'
import {
  conversationPeerUsername,
  findAgentByUsername,
  historyToVoiceItems,
  isGrokVoiceOmniModel,
  isVoiceEchoText,
  LIVE_S2S_MEMORY_KEY,
  liveVoiceAgent,
  pickActiveLiveVoice,
  readRememberedLiveS2S,
  rememberLiveS2S,
  resolveLiveVoiceTarget,
  persistVoiceTurn,
  shouldHoldMicWhileSpeaking,
  stripGrokVoicePrefix,
} from '../utils/grokVoice'

afterEach(() => {
  localStorage.removeItem(LIVE_S2S_MEMORY_KEY)
})

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

describe('resolveLiveVoiceTarget', () => {
  const agents = [
    { username: 'ena', model: 'cortex/grok-4.6' },
    { username: 'hina', model: 'cortex/grok-voice-think-fast-2.0' },
  ]
  const hinaThread = {
    participants: [
      { user_id: 1, username: 'hritik' },
      { user_id: 698, username: 'hina' },
    ],
  }
  const enaThread = {
    participants: [
      { user_id: 1, username: 'hritik' },
      { user_id: 2, username: 'ena' },
    ],
  }

  it('keeps homepage Live on the picker so a leftover Hina thread cannot steal Ena', () => {
    const target = resolveLiveVoiceTarget({
      agents,
      conversation: hinaThread,
      preferPeer: false,
      pickerUsername: 'ena',
      currentUserId: 1,
    })
    expect(target).toMatchObject({ username: 'ena', s2s: false })
  })

  it('uses native Voice on homepage when the picker is Hina', () => {
    const target = resolveLiveVoiceTarget({
      agents,
      conversation: enaThread,
      preferPeer: false,
      pickerUsername: 'hina',
      currentUserId: 1,
    })
    expect(target).toMatchObject({ username: 'hina', s2s: true })
    expect(target.model).toContain('grok-voice')
  })

  it('follows the open /c/:id peer even if the homepage picker is someone else', () => {
    const onHina = resolveLiveVoiceTarget({
      agents,
      conversation: hinaThread,
      preferPeer: true,
      pickerUsername: 'ena',
      currentUserId: 1,
    })
    expect(onHina).toMatchObject({ username: 'hina', s2s: true })
    const onEna = resolveLiveVoiceTarget({
      agents,
      conversation: enaThread,
      preferPeer: true,
      pickerUsername: 'hina',
      currentUserId: 1,
    })
    expect(onEna).toMatchObject({ username: 'ena', s2s: false })
  })

  it('stays on cascade when the model is unknown and nothing is remembered', () => {
    const target = resolveLiveVoiceTarget({
      agents: [],
      pickerUsername: 'yuna',
      currentUserId: 1,
    })
    expect(target).toMatchObject({ username: 'yuna', model: '', s2s: false })
  })

  it('recalls a previous Grok Voice seat before the roster hydrates', () => {
    rememberLiveS2S('hina', true)
    expect(readRememberedLiveS2S('hina')).toBe(true)
    const target = resolveLiveVoiceTarget({
      agents: [],
      pickerUsername: 'hina',
      currentUserId: 1,
    })
    expect(target).toMatchObject({ username: 'hina', s2s: true })
  })
})

describe('pickActiveLiveVoice', () => {
  const idle = { callState: 'idle' }
  const live = { callState: 'listening' }

  it('locks HUD and controls to the hook that is already in a call', () => {
    expect(pickActiveLiveVoice(live, idle, false).path).toBe('s2s')
    expect(pickActiveLiveVoice(idle, live, true).path).toBe('cascade')
  })

  it('follows the preferred path only when both hooks are idle', () => {
    expect(pickActiveLiveVoice(idle, idle, true).path).toBe('s2s')
    expect(pickActiveLiveVoice(idle, idle, false).path).toBe('cascade')
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

describe('persistVoiceTurn', () => {
  it('skips when conversation or text is missing', async () => {
    expect(await persistVoiceTurn({ conversationId: '', userText: 'hi' })).toEqual({ ok: false, status: 0 })
    expect(await persistVoiceTurn({ conversationId: 'c1' })).toEqual({ ok: false, status: 0 })
  })
})
