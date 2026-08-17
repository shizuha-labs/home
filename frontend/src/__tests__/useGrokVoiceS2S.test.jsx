import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGrokVoiceS2S } from '../hooks/useGrokVoiceS2S'

class FakeSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
    this.binaryType = 'blob'
    FakeSocket.instances.push(this)
    this.listeners = {}
  }
  addEventListener(type, cb) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(cb)
  }
  removeEventListener(type, cb) {
    this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== cb)
  }
  send(data) { this.sent.push(data) }
  close() { this.readyState = 3 }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  emit(data) {
    const event = { data }
    this.onmessage?.(event)
    for (const fn of this.listeners.message || []) fn(event)
  }
}

describe('useGrokVoiceS2S', () => {
  const originalWS = globalThis.WebSocket
  const originalMedia = navigator.mediaDevices

  beforeEach(() => {
    FakeSocket.OPEN = 1
    FakeSocket.CONNECTING = 0
    FakeSocket.CLOSING = 2
    FakeSocket.CLOSED = 3
    FakeSocket.instances = []
    localStorage.setItem('shizuha_access_token', 'test-token')
    globalThis.WebSocket = FakeSocket
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn(), enabled: true }],
          getAudioTracks: () => [{ enabled: true }],
        })),
      },
    })
    globalThis.AudioContext = class {
      constructor() { this.sampleRate = 24000; this.state = 'running' }
      resume() { return Promise.resolve() }
      close() { return Promise.resolve() }
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
      createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} } }
    }
    globalThis.webkitAudioContext = globalThis.AudioContext
  })

  afterEach(() => {
    globalThis.WebSocket = originalWS
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMedia })
  })

  it('opens the realtime socket instead of STT and stays on S2S', async () => {
    const { result } = renderHook(() => useGrokVoiceS2S({
      conversationId: 'conv-1',
      agentUsername: 'hina',
      model: 'cortex/grok-voice-think-fast-2.0',
    }))
    await act(async () => { result.current.startCall() })
    const socket = FakeSocket.instances.at(-1)
    expect(socket.url).toContain('/voice/api/realtime/stream')
    await act(async () => { socket.open() })
    const start = JSON.parse(socket.sent[0])
    expect(start.type).toBe('start')
    expect(start.agent_username).toBe('hina')
    expect(start.conversation_id).toBe('conv-1')
    await act(async () => { socket.emit(JSON.stringify({ type: 'ready', model: 'grok-voice-think-fast-2.0' })) })
    expect(result.current.callState).toBe('listening')
    expect(result.current.transport).toBe('s2s')
    expect(result.current.isCallActive()).toBe(true)
  })

  it('surfaces the user transcript without sending a Connect utterance', async () => {
    const { result } = renderHook(() => useGrokVoiceS2S({
      conversationId: 'conv-1',
      agentUsername: 'hina',
      model: 'cortex/grok-voice-think-fast-2.0',
    }))
    await act(async () => { result.current.startCall() })
    const socket = FakeSocket.instances.at(-1)
    await act(async () => { socket.open() })
    await act(async () => {
      socket.emit(JSON.stringify({ type: 'ready' }))
      socket.emit(JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'What is on my queue?',
      }))
    })
    expect(result.current.lastHeard).toBe('What is on my queue?')
    expect(result.current.callState).toBe('thinking')
  })

  it('holds the mic while she speaks and ignores her own line as a user turn', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useGrokVoiceS2S({
      conversationId: 'conv-1',
      agentUsername: 'hina',
      model: 'cortex/grok-voice-think-fast-2.0',
    }))
    await act(async () => { result.current.startCall() })
    const socket = FakeSocket.instances.at(-1)
    await act(async () => { socket.open() })
    await act(async () => { socket.emit(JSON.stringify({ type: 'ready' })) })
    await act(async () => {
      socket.emit(JSON.stringify({
        type: 'response.output_audio.delta',
        delta: '',
      }))
      socket.emit(JSON.stringify({
        type: 'response.output_audio_transcript.done',
        transcript: "Hi. Queue's clean. How can I help?",
      }))
    })
    expect(result.current.callState).toBe('speaking')
    const micOff = socket.sent.map((row) => {
      if (typeof row !== 'string') return null
      try { return JSON.parse(row) } catch { return null }
    }).filter(Boolean).filter((row) => row.type === 'mic')
    expect(micOff.at(-1)).toMatchObject({ type: 'mic', enabled: false })
    await act(async () => {
      socket.emit(JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: "Hi. Queue's clean. How can I help?",
      }))
    })
    expect(result.current.lastHeard).toBe('')
    await act(async () => {
      socket.emit(JSON.stringify({ type: 'response.done' }))
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.callState).toBe('listening')
    vi.useRealTimers()
  })
})
