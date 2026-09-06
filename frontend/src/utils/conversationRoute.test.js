import { describe, expect, it } from 'vitest'
import {
  conversationIdFromPath,
  isHomeAppPath,
  nextThreadAfterRouteChange,
  threadInitialUnreadCount,
} from './conversationRoute'

describe('conversationIdFromPath', () => {
  it('reads a thread id from /c/:id', () => {
    expect(conversationIdFromPath('/c/bb516974-4152-427a-a2ac-04535b5f393f'))
      .toBe('bb516974-4152-427a-a2ac-04535b5f393f')
  })

  it('ignores query strings and trailing slashes', () => {
    expect(conversationIdFromPath('/c/abc/')).toBe('abc')
    expect(conversationIdFromPath('/c/abc?x=1')).toBe('abc')
  })

  it('returns null off the thread route', () => {
    expect(conversationIdFromPath('/')).toBeNull()
    expect(conversationIdFromPath('/c')).toBeNull()
    expect(conversationIdFromPath('/hive')).toBeNull()
  })
})

describe('isHomeAppPath', () => {
  it('treats dashboard and thread URLs as in-app', () => {
    expect(isHomeAppPath('/')).toBe(true)
    expect(isHomeAppPath('/c')).toBe(true)
    expect(isHomeAppPath('/c/abc')).toBe(true)
    expect(isHomeAppPath('/c/abc?peek=1')).toBe(true)
  })

  it('leaves other surfaces as document navigations', () => {
    expect(isHomeAppPath('/hive')).toBe(false)
    expect(isHomeAppPath('/pulse')).toBe(false)
    expect(isHomeAppPath('/admin')).toBe(false)
  })
})

describe('nextThreadAfterRouteChange', () => {
  const thread = 'bb516974-4152-427a-a2ac-04535b5f393f'

  it('activates the URL thread and clears mini-chat', () => {
    expect(nextThreadAfterRouteChange({
      urlConversationId: thread,
      activeConversationId: null,
      miniConvId: thread,
      callState: 'listening',
    })).toEqual({ activeConversationId: thread, miniConvId: null })
  })

  it('parks the thread as mini-chat when leaving /c/:id mid-call', () => {
    expect(nextThreadAfterRouteChange({
      urlConversationId: null,
      activeConversationId: thread,
      miniConvId: null,
      callState: 'listening',
    })).toEqual({ activeConversationId: thread, miniConvId: thread })
  })

  it('clears the thread when leaving /c/:id idle', () => {
    expect(nextThreadAfterRouteChange({
      urlConversationId: null,
      activeConversationId: thread,
      miniConvId: null,
      callState: 'idle',
    })).toEqual({ activeConversationId: null, miniConvId: null })
  })

  it('keeps an existing mini-chat on the dashboard', () => {
    expect(nextThreadAfterRouteChange({
      urlConversationId: null,
      activeConversationId: thread,
      miniConvId: thread,
      callState: 'speaking',
    })).toEqual({ activeConversationId: thread, miniConvId: thread })
  })
})

describe('threadInitialUnreadCount', () => {
  const thread = 'bb516974-4152-427a-a2ac-04535b5f393f'

  it('drops leftover unread when expanding the already-open mini-chat', () => {
    expect(threadInitialUnreadCount({
      miniConvId: thread,
      activeConversationId: thread,
      captured: 6,
    })).toBe(0)
  })

  it('keeps the captured unread on a cold /c/:id open', () => {
    expect(threadInitialUnreadCount({
      miniConvId: null,
      activeConversationId: thread,
      captured: 6,
    })).toBe(6)
  })
})
