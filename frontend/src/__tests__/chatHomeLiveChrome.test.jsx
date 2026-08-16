/**
 * Expanded /c/:id must keep Live chrome (button + HUD) and the same
 * voice hook surface as the homepage compose strip.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
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
  resumeListen: vi.fn(),
  isCallActive: () => voice.callState !== 'idle' && voice.callState !== 'error',
}

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, first_name: 'Hritik', username: 'hritik' },
    isAuthenticated: true,
  }),
}))

vi.mock('../hooks/useVoice', () => ({
  useVoiceConversation: () => voice,
  useVoiceInput: () => ({ micState: 'idle', micSupported: true, toggleMic: vi.fn() }),
  speakText: Object.assign(vi.fn(), { stop: vi.fn() }),
  speakDelta: vi.fn(),
  nextSpokenSentences: () => ({ sentences: [], spoken: '' }),
  spokenCovers: () => true,
  waitSpeakIdle: async () => {},
  finishSpeakStream: vi.fn(),
  stripSpeakableMarkup: (s) => s,
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
      isConnected: true,
      messages: [],
      typingUsers: new Map(),
      onlineUsers: new Set(),
      hasMore: false,
      isLoadingMessages: false,
      loadMore: vi.fn(),
      sendMessage: vi.fn(),
      streamingByConv: {},
    }),
    MessageList: () => React.createElement('div', { 'data-testid': 'message-list' }, 'messages'),
    MessageInput: () => React.createElement('div', { 'data-testid': 'message-input' }, 'input'),
    Avatar: () => React.createElement('div', { 'data-testid': 'avatar' }),
    NewChatModal: () => null,
  }
})

vi.mock('@shizuha/ui', () => ({
  SHIZUHA_APPS: [],
  useEnabledServices: () => ({ enabledServices: null }),
}))

import ChatHome from '../pages/ChatHome'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<ChatHome />} />
        <Route path="/c/:conversationId" element={<ChatHome />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ChatHome Live chrome', () => {
  beforeEach(() => {
    voice.callState = 'idle'
    voice.callError = null
  })

  it('shows Live + speak + mic on the expanded thread', () => {
    renderAt(`/c/${CONV}`)
    expect(screen.getByTestId('thread-live-button')).toBeInTheDocument()
    expect(screen.getByTestId('thread-speak-button')).toBeInTheDocument()
    expect(screen.getByTestId('thread-mic-button')).toBeInTheDocument()
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
    renderAt('/')
    act(() => {
      screen.getByTestId('home-live-button').click()
    })
    expect(screen.getByRole('button', { name: /Open full chat/i })).toBeInTheDocument()
  })
})
