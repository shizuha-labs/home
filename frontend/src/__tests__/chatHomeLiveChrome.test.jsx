/**
 * Expanded /c/:id must keep Live chrome (button + HUD) and the same
 * voice hook surface as the homepage compose strip.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const CONV = 'bb516974-4152-427a-a2ac-04535b5f393f'
const voice = {
  callState: 'idle',
  callError: null,
  muted: false,
  lastHeard: '',
  startCall: vi.fn(),
  endCall: vi.fn(),
  retryCall: vi.fn(),
  toggleMute: vi.fn(),
  notifyReply: vi.fn(),
  beginSpeak: vi.fn(),
  endSpeak: vi.fn(),
  cancelSpeak: vi.fn(),
  resumeListen: vi.fn(),
  isCallActive: () => voice.callState !== 'idle' && voice.callState !== 'error',
}

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, first_name: 'Hritik', username: 'hritik' },
    isAuthenticated: true,
  }),
}))

vi.mock('../hooks/useGrokVoiceS2S', () => ({
  useGrokVoiceS2S: () => ({ ...voice, transport: 's2s', lastReply: '' }),
}))

vi.mock('../hooks/useVoice', () => ({
  useVoiceConversation: () => voice,
  useVoiceInput: () => ({ micState: 'idle', micSupported: true, toggleMic: vi.fn() }),
  speakText: Object.assign(vi.fn(), { stop: vi.fn() }),
  speakDelta: vi.fn(),
  nextSpokenSentences: () => ({ sentences: [], spoken: '' }),
  spokenCovers: (full, spoken) => {
    const a = String(full || '').replace(/\s+/g, ' ').trim()
    const b = String(spoken || '').replace(/\s+/g, ' ').trim()
    return !!b && a.startsWith(b)
  },
  waitSpeakIdle: async () => {},
  finishSpeakStream: vi.fn(),
  stripSpeakableMarkup: (s) => s,
  isTalkAckText: (text) => /^(replied|done|sent|ok|noted|pong sent)[.!]?$/i.test(String(text || '').trim()),
  isGhostTranscript: (text) => /^keyterms?\s*:/i.test(String(text || '').trim()),
  readTtsSpeed: () => 1.2,
  cycleTtsSpeed: () => 1.4,
  formatTtsSpeed: (n) => `${n}×`,
}))

vi.mock('../hooks/useHomeSummary', () => ({
  useHomeSummary: () => ({ summary: { orgs: [{ id: 1, name: 'Shizuha' }] } }),
}))

vi.mock('../hooks/useHomeActivity', () => ({
  useHomeActivity: () => ({
    widget: () => ({ status: 'ok', data: [] }),
  }),
}))

vi.mock('../utils/auth', () => ({
  getAccessToken: () => 'test-token',
  handleUnauthorized: () => false,
}))

vi.mock('../components/dashboard/CommandCenterDashboard', () => ({
  default: () => createElement('div', { 'data-testid': 'dashboard' }, 'dashboard'),
}))
vi.mock('../components/dashboard/LiveTheater', () => ({
  default: () => createElement('div', { 'data-testid': 'theater' }, 'theater'),
}))
vi.mock('../components/dashboard/OrgProgressCharts', () => ({
  default: () => null,
}))
vi.mock('../components/dashboard/CockpitPeek', () => ({
  default: () => null,
}))
vi.mock('../components/assistant/CommandPalette', () => ({
  default: () => null,
}))
vi.mock('../components/assistant/HomeAgentPicker', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-picker' }, 'picker'),
}))

const chat = {
  messages: [],
  streamingByConv: {},
  isConnected: true,
  sendMessage: vi.fn(),
}

vi.mock('@shizuha/chat', () => {
  const React = require('react')
  return {
    ConnectChatProvider: ({ children }) => children,
    useConnectChat: () => ({
      conversations: [{
        id: CONV,
        participants: [
          { user_id: 1, username: 'hritik', first_name: 'Hritik' },
          { user_id: 2, username: 'ena', first_name: 'Ena', email: 'ena@shizuha.com' },
        ],
      }],
      activeConversationId: CONV,
      activeInitialUnread: 0,
      setActiveConversation: vi.fn(),
      createDirectConversation: vi.fn(),
      get isConnected() { return chat.isConnected },
      get messages() { return chat.messages },
      typingUsers: new Map(),
      onlineUsers: new Set(),
      hasMore: false,
      isLoadingMessages: false,
      loadMore: vi.fn(),
      sendMessage: (...args) => chat.sendMessage(...args),
      get streamingByConv() { return chat.streamingByConv },
    }),
    MessageList: ({ messages }) => React.createElement(
      'div',
      { 'data-testid': 'message-list' },
      (messages || []).map((m) => m.content).join(' | '),
    ),
    MessageInput: ({ onSend, disabled, placeholder }) => React.createElement(
      'div',
      { 'data-testid': 'message-input' },
      React.createElement('button', {
        type: 'button',
        'data-testid': 'thread-send-button',
        disabled: !!disabled,
        onClick: () => onSend?.('thread send probe'),
      }, placeholder || 'input'),
    ),
    Avatar: () => React.createElement('div', { 'data-testid': 'avatar' }),
    NewChatModal: () => null,
  }
})

vi.mock('@shizuha/ui', () => ({
  SHIZUHA_APPS: [],
  useEnabledServices: () => ({ enabledServices: null }),
}))

import ChatHome from '../pages/ChatHome'
import { speakText } from '../hooks/useVoice'

function ChatHomeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChatHome />} />
      <Route path="/c/:conversationId" element={<ChatHome />} />
    </Routes>
  )
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatHomeRoutes />
    </MemoryRouter>,
  )
}

function PersistHarness() {
  const [, setTick] = useState(0)
  PersistHarness.tick = () => setTick((n) => n + 1)
  return (
    <MemoryRouter initialEntries={['/']}>
      <ChatHomeRoutes />
    </MemoryRouter>
  )
}

describe('ChatHome Live chrome', () => {
  beforeEach(() => {
    voice.callState = 'idle'
    voice.callError = null
    voice.endSpeak.mockClear()
    voice.cancelSpeak.mockClear()
    voice.beginSpeak.mockClear()
    voice.startCall.mockClear()
    voice.endCall.mockClear()
    voice.notifyReply.mockClear()
    speakText.mockClear()
    speakText.stop.mockClear()
    chat.messages = []
    chat.streamingByConv = {}
    chat.isConnected = true
    chat.sendMessage.mockClear()
    localStorage.clear()
  })

  it('sends on the open /c/:id thread even when the socket is reconnecting', () => {
    chat.isConnected = false
    renderAt(`/c/${CONV}`)
    const send = screen.getByTestId('thread-send-button')
    expect(send).not.toBeDisabled()
    act(() => {
      send.click()
    })
    expect(chat.sendMessage).toHaveBeenCalledWith('thread send probe', CONV)
  })

  it('shows Live + speak + mic on the expanded thread', () => {
    renderAt(`/c/${CONV}`)
    expect(screen.getByTestId('thread-live-button')).toBeInTheDocument()
    expect(screen.getByTestId('thread-speak-button')).toBeInTheDocument()
    expect(screen.getByTestId('thread-mic-button')).toBeInTheDocument()
    expect(screen.getByTestId('tts-speed-button')).toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.queryByTestId('live-voice-overlay')).not.toBeInTheDocument()
  })

  it('keeps the HUD on the expanded thread while Live is up', () => {
    voice.callState = 'listening'
    renderAt(`/c/${CONV}`)
    expect(screen.getByTestId('live-voice-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('thread-live-button')).toHaveAttribute('aria-label', 'End Live')
  })

  it('shows the homepage Live control on the dashboard', () => {
    renderAt('/')
    expect(screen.getByTestId('home-live-button')).toBeInTheDocument()
  })

  it('attaches the home-agent thread as mini-chat when Live starts on /', () => {
    localStorage.setItem('shizuha_home_agent', 'ena')
    renderAt('/')
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    expect(screen.getByRole('button', { name: /Open full chat/i })).toBeInTheDocument()
  })

  it('hides Replied. leftovers and Keyterms dumps on the homepage strip and full thread', () => {
    chat.messages = [
      { id: 'u1', sender_id: 1, content: "Yo, what's up?" },
      { id: 'a1', sender_id: 2, sender_name: 'Ena', content: "Hey. I'm here. What do you need?" },
      { id: 'a2', sender_id: 2, sender_name: 'Ena', content: 'Replied.' },
      { id: 'a3', sender_id: 2, sender_name: 'Ena', content: 'Keyterms: Shizuha, Hritik, Hive, Cortex, Pulse' },
    ]
    voice.callState = 'listening'
    renderAt('/')
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    const strip = screen.getByTestId('mini-chat-scroll')
    expect(strip.textContent).toMatch(/yo, what's up/i)
    expect(strip.textContent).toMatch(/hey\. i'm here/i)
    expect(strip.textContent).not.toMatch(/replied/i)
    expect(strip.textContent).not.toMatch(/keyterms/i)

    renderAt(`/c/${CONV}`)
    expect(screen.getByTestId('message-list').textContent).toMatch(/yo, what's up/i)
    expect(screen.getByTestId('message-list').textContent).toMatch(/hey\. i'm here/i)
    expect(screen.getByTestId('message-list').textContent).not.toMatch(/replied/i)
    expect(screen.getByTestId('message-list').textContent).not.toMatch(/keyterms/i)
  })

  it('does not replay an hours-old last reply when Live starts, then speaks a new persist', () => {
    // Production order: open thread with last agent turn from hours ago →
    // Start Live with no new utterance → must stay silent. A persist that
    // lands after start still speaks.
    chat.messages = [
      {
        id: 'a1',
        sender_id: 2,
        sender_name: 'Ena',
        content: "Let's do BKSG-48.",
        created_at: '2026-08-16T16:46:26Z',
      },
    ]
    voice.callState = 'idle'
    render(<PersistHarness />)
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    expect(voice.startCall).toHaveBeenCalled()
    expect(speakText).not.toHaveBeenCalled()
    expect(voice.notifyReply).not.toHaveBeenCalled()

    voice.callState = 'listening'
    voice.notifyReply.mockClear()
    speakText.mockClear()
    chat.messages = [
      ...chat.messages,
      {
        id: 'a2',
        sender_id: 2,
        sender_name: 'Ena',
        content: 'Here. I just said this.',
        created_at: new Date().toISOString(),
      },
    ]
    act(() => {
      PersistHarness.tick()
    })
    expect(voice.notifyReply).toHaveBeenCalledWith('Here. I just said this.')
    expect(speakText).not.toHaveBeenCalled()
  })

  it('speaks a reply that just landed when Live starts', () => {
    chat.messages = [
      {
        id: 'a1',
        sender_id: 2,
        sender_name: 'Ena',
        content: 'Just said this.',
        created_at: new Date().toISOString(),
      },
    ]
    voice.callState = 'idle'
    render(<PersistHarness />)
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    expect(speakText.mock.calls[0]?.[0] || voice.notifyReply.mock.calls[0]?.[0])
      .toBe('Just said this.')
  })

  it('does not replay history that hydrates after Live starts', () => {
    chat.messages = []
    voice.callState = 'idle'
    render(<PersistHarness />)
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    voice.callState = 'listening'
    chat.messages = [
      {
        id: 'a1',
        sender_id: 2,
        sender_name: 'Ena',
        content: "Let's do BKSG-48.",
        created_at: '2026-08-16T16:46:26Z',
      },
    ]
    act(() => {
      PersistHarness.tick()
    })
    expect(speakText).not.toHaveBeenCalled()
    expect(voice.notifyReply).not.toHaveBeenCalled()
  })

  it('ends speak after a Replied. persist on the same mount so Live does not freeze on Speaking', () => {
    // Production order: Start Live → agent sentence → leftover "Replied."
    // persist on the SAME ChatHome instance (not a remount).
    chat.messages = [
      { id: 'a1', sender_id: 2, sender_name: 'Ena', content: "Hey. I'm here." },
    ]
    voice.callState = 'idle'
    render(<PersistHarness />)
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    expect(voice.startCall).toHaveBeenCalled()
    expect(voice.endCall).not.toHaveBeenCalled()
    voice.callState = 'speaking'
    voice.endSpeak.mockClear()
    chat.messages = [
      { id: 'a1', sender_id: 2, sender_name: 'Ena', content: "Hey. I'm here." },
      { id: 'a2', sender_id: 2, sender_name: 'Ena', content: 'Replied.' },
    ]
    act(() => {
      PersistHarness.tick()
    })
    expect(voice.endSpeak).toHaveBeenCalled()
  })

  it('cuts in-flight TTS when Voice replies is turned off mid-speak', () => {
    localStorage.setItem('shizuha_speak_replies', '1')
    voice.callState = 'speaking'
    renderAt(`/c/${CONV}`)
    act(() => {
      screen.getByTestId('thread-speak-button').click()
    })
    expect(speakText.stop).toHaveBeenCalled()
    expect(voice.cancelSpeak).toHaveBeenCalled()
    expect(voice.endSpeak).not.toHaveBeenCalled()
    expect(screen.getByTestId('thread-speak-button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('thread-speak-button')).toHaveAttribute('title', 'Voice replies off')
  })

  it('cuts in-flight TTS from the HUD Voice replies button', () => {
    localStorage.setItem('shizuha_speak_replies', '1')
    voice.callState = 'speaking'
    renderAt(`/c/${CONV}`)
    act(() => {
      screen.getByTestId('hud-speak-button').click()
    })
    expect(speakText.stop).toHaveBeenCalled()
    expect(voice.cancelSpeak).toHaveBeenCalled()
    expect(screen.getByTestId('hud-speak-button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('hud-speak-button')).toHaveAttribute('title', 'Voice replies off')
  })

  it('cuts in-flight TTS from the mini-chat Voice replies button', () => {
    localStorage.setItem('shizuha_speak_replies', '1')
    localStorage.setItem('shizuha_home_agent', 'ena')
    voice.callState = 'speaking'
    renderAt('/')
    act(() => {
      screen.getByTestId('mini-speak-button').click()
    })
    expect(speakText.stop).toHaveBeenCalled()
    expect(voice.cancelSpeak).toHaveBeenCalled()
    expect(screen.getByTestId('mini-speak-button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('mini-speak-button')).toHaveAttribute('title', 'Voice replies off')
  })
})
