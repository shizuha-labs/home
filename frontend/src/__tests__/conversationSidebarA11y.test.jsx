/**
 * CON-496: the conversation rail's accessible names must not glue the unread
 * count (or any visual text) into the conversation name. A row with 16 unread
 * must announce "<name>, 16 unread" — name and count spoken separately — and
 * the icon-only controls (new chat, home, search) must be named.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('@shizuha/chat', () => ({
  Avatar: ({ name }) => createElement('div', { 'data-testid': 'avatar' }, String(name || '').slice(0, 2)),
}))

import ConversationSidebar from '../components/assistant/ConversationSidebar'

const baseConv = (over = {}) => ({
  id: 1,
  conversation_type: 'direct',
  last_message_at: '2026-10-01T10:00:00Z',
  last_message_preview: 'Recurring Task Due',
  participants: [{ user_id: 42, user_name: 'Hina' }],
  unread_count: 0,
  ...over,
})

const noop = () => {}
const renderSidebar = (props = {}) =>
  render(
    createElement(ConversationSidebar, {
      conversations: [baseConv()],
      currentUserId: 1,
      currentUser: { email: 'me@shizuha.io' },
      onSelectConversation: noop,
      onNewChat: noop,
      onHome: noop,
      onSearchAgents: null,
      onStartAgent: noop,
      ...props,
    }),
  )

describe('ConversationSidebar a11y (CON-496)', () => {
  it('announces the unread count separately from the name', () => {
    renderSidebar({ conversations: [baseConv({ unread_count: 16 })] })
    const row = screen.getByRole('button', { name: 'Hina, 16 unread' })
    expect(row).toBeTruthy()
    // The glue regression: no accessible name may fuse name + count digits.
    expect(screen.queryByRole('button', { name: /Hina16/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /16Hina/ })).toBeNull()
  })

  it('keeps a read row named with the conversation name only', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Hina' })).toBeTruthy()
  })

  it('does not add an unread suffix to the active conversation', () => {
    renderSidebar({
      conversations: [baseConv({ unread_count: 16 })],
      activeConversationId: 1,
    })
    expect(screen.getByRole('button', { name: 'Hina' })).toBeTruthy()
  })

  it('names the icon-only controls; pending requests ride the new-chat name', () => {
    renderSidebar({ pendingRequestCount: 3 })
    expect(screen.getByRole('button', { name: 'New chat, 3 pending requests' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy()
    expect(screen.getByLabelText('Search or start a chat')).toBeTruthy()
  })

  it('names the new-chat button plainly when nothing is pending', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy()
  })
})
