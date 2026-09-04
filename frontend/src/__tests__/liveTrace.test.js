import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginLiveCall,
  emitLiveTrace,
  getLiveTraceContext,
  recentLiveTrace,
  resetLiveTraceForTests,
  setLiveTraceContext,
  voiceCorrelation,
} from '../utils/liveTrace'

describe('liveTrace', () => {
  beforeEach(() => {
    resetLiveTraceForTests()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
    localStorage.setItem('shizuha_access_token', 'test-token')
  })

  afterEach(() => {
    resetLiveTraceForTests()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('binds a call and redacts secrets from attrs', () => {
    setLiveTraceContext({ conversationId: 'bb516974-4152-427a-a2ac-04535b5f393f', userId: 1, agent: 'ena' })
    const ctx = beginLiveCall()
    expect(ctx.callId).toMatch(/^[0-9a-f]+$/)
    expect(voiceCorrelation().conversation_id).toBe('bb516974-4152-427a-a2ac-04535b5f393f')
    emitLiveTrace('ui.click', { label: 'Voice replies off', token: 'secret-token', authorization: 'Bearer abc' })
    const last = recentLiveTrace(5).at(-1)
    expect(last.name).toBe('ui.click')
    expect(last.attrs.label).toBe('Voice replies off')
    expect(last.attrs.token).toBeUndefined()
    expect(last.attrs.authorization).toBeUndefined()
    expect(getLiveTraceContext().callId).toBe(ctx.callId)
  })

  it('drops illegal event names', () => {
    expect(emitLiveTrace('Not A Name', { x: 1 })).toBeNull()
    expect(recentLiveTrace()).toHaveLength(0)
  })
})
