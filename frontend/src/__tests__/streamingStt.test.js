import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startStreamingStt } from '../utils/streamingStt'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('startStreamingStt startup cancellation', () => {
  let track
  let stream
  let context
  let sockets
  let audioContextCalls

  beforeEach(() => {
    track = { stop: vi.fn() }
    stream = { getTracks: () => [track] }
    context = {
      sampleRate: 16000,
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createScriptProcessor: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null })),
      createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } })),
      destination: {},
    }
    audioContextCalls = 0
    sockets = []
    class FakeWebSocket {
      static OPEN = 1
      static CONNECTING = 0
      constructor() {
        this.readyState = FakeWebSocket.CONNECTING
        this.close = vi.fn(() => { this.readyState = 3 })
        this.send = vi.fn()
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    class FakeAudioContext {
      constructor() {
        audioContextCalls += 1
        return context
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns a controller synchronously and stops tracks acquired after stop', async () => {
    const permission = deferred()
    navigator.mediaDevices.getUserMedia.mockReturnValue(permission.promise)
    const onError = vi.fn()

    const controller = startStreamingStt({ token: 'token', onError })
    expect(controller.stop).toBeTypeOf('function')
    controller.stop()
    permission.resolve(stream)
    await flush()

    expect(track.stop).toHaveBeenCalledOnce()
    expect(audioContextCalls).toBe(0)
    expect(sockets).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('closes stream and context when cancelled during context resume', async () => {
    const resumed = deferred()
    context.resume.mockReturnValue(resumed.promise)
    const controller = startStreamingStt({ token: 'token' })
    await flush()
    expect(audioContextCalls).toBe(1)

    controller.cancel()
    resumed.resolve()
    await flush()

    expect(track.stop).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
    expect(sockets).toHaveLength(0)
  })

  it('closes the socket and never connects audio when stopped before readiness', async () => {
    const controller = startStreamingStt({ token: 'token' })
    await flush()
    expect(sockets).toHaveLength(1)

    controller.stop()

    expect(track.stop).toHaveBeenCalled()
    expect(sockets[0].close).toHaveBeenCalled()
    expect(context.createMediaStreamSource.mock.results[0].value.connect).not.toHaveBeenCalled()
  })
})
