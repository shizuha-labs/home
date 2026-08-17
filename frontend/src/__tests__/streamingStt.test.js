import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  startStreamingStt,
  utteranceLooksIncomplete,
  shouldCommitOnMute,
  sttCommitHangoverMs,
  stitchHeard,
  isTranscriptExtension,
  STT_INCOMPLETE_HANGOVER_MS,
  STT_COMPLETE_HANGOVER_MS,
  STT_COMMIT_QUIET_MS,
  STT_MUTE_COMMIT_MS,
} from '../utils/streamingStt'

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

describe('utterance endpointing', () => {
  it('treats hanging clauses and digit strings as incomplete; only ?/! end a turn', () => {
    expect(utteranceLooksIncomplete('I want you to check')).toBe(true)
    expect(utteranceLooksIncomplete('I want you to check this 5 9 3 6 task.')).toBe(true)
    expect(utteranceLooksIncomplete('check the second task if it is relevant.')).toBe(true)
    expect(utteranceLooksIncomplete("What's up?")).toBe(false)
    expect(sttCommitHangoverMs('I want you to check')).toBe(STT_INCOMPLETE_HANGOVER_MS)
    expect(sttCommitHangoverMs("What's up?")).toBe(STT_COMPLETE_HANGOVER_MS)
  })

  it('keeps five-nine-three-six and like-log-in-there open', () => {
    expect(utteranceLooksIncomplete(
      'So regarding the five nine three six task can you check into S one like log in there?',
    )).toBe(true)
    expect(sttCommitHangoverMs(
      'So regarding the five nine three six task can you check into S one like log in there?',
    )).toBe(STT_INCOMPLETE_HANGOVER_MS)
  })
})

describe('startStreamingStt hangover', () => {
  let sockets
  let processor

  beforeEach(() => {
    vi.useFakeTimers()
    sockets = []
    processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }
    class FakeWebSocket {
      static OPEN = 1
      static CONNECTING = 0
      constructor() {
        this.readyState = FakeWebSocket.OPEN
        this.close = vi.fn()
        this.send = vi.fn()
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const context = {
      sampleRate: 16000,
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createScriptProcessor: vi.fn(() => processor),
      createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } })),
      destination: {},
    }
    vi.stubGlobal('AudioContext', class { constructor() { return context } })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn(), enabled: true }],
        getAudioTracks: () => [{ stop: vi.fn(), enabled: true }],
      }) },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const readyAndPartial = async (onFinal, onPartial) => {
    startStreamingStt({ token: 'token', onFinal, onPartial })
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    const ws = sockets[0]
    expect(ws).toBeTruthy()
    ws.onmessage({ data: JSON.stringify({ type: 'transcript.created' }) })
    return ws
  }

  it('does not send a mid-clause speech_final until the hangover elapses', async () => {
    const onFinal = vi.fn()
    const ws = await readyAndPartial(onFinal)
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'I want you to check',
        speech_final: true,
        is_final: true,
      }),
    })
    expect(onFinal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(onFinal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS)
    expect(onFinal).toHaveBeenCalledWith('I want you to check', expect.any(Object))
  })

  it('cancels the premature commit when the speaker continues', async () => {
    const onFinal = vi.fn()
    const onPartial = vi.fn()
    const ws = await readyAndPartial(onFinal, onPartial)
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'I want you to check',
        speech_final: true,
        is_final: true,
      }),
    })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'I want you to check the second task if it is relevant',
        speech_final: false,
        is_final: false,
      }),
    })
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS + 200)
    expect(onFinal).not.toHaveBeenCalled()
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'I want you to check the second task if it is relevant.',
        speech_final: true,
        is_final: true,
      }),
    })
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS + 200)
    expect(onFinal).toHaveBeenCalledTimes(1)
    expect(onFinal.mock.calls[0][0]).toMatch(/relevant/i)
  })

  it('stitches a mid-thought when Grok resets the transcript after a pause', async () => {
    const onFinal = vi.fn()
    const onPartial = vi.fn()
    const ws = await readyAndPartial(onFinal, onPartial)
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'I want you to check',
        speech_final: true,
        is_final: true,
      }),
    })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'this five nine three six Pulse task',
        speech_final: false,
        is_final: false,
      }),
    })
    expect(onPartial).toHaveBeenLastCalledWith(
      expect.stringMatching(/I want you to check.*five nine three six/i),
      expect.any(Object),
    )
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS + 200)
    expect(onFinal).toHaveBeenCalledTimes(1)
    expect(onFinal.mock.calls[0][0]).toMatch(/I want you to check/i)
    expect(onFinal.mock.calls[0][0]).toMatch(/five nine three six/i)
  })

  it('does not let transcript.done skip hangover on an unfinished clause', async () => {
    const onFinal = vi.fn()
    const onDone = vi.fn()
    startStreamingStt({ token: 'token', onFinal, onDone })
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    const ws = sockets[0]
    ws.onmessage({ data: JSON.stringify({ type: 'transcript.created' }) })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'So regarding the five nine three six task can you check into S one like log in there?',
        speech_final: true,
      }),
    })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.done',
        text: 'So regarding the five nine three six task can you check into S one like log in there?',
      }),
    })
    expect(onFinal).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ hold: true }))
  })

  it('defers commit while the mic is still loud (production: keep talking after there)', async () => {
    const onFinal = vi.fn()
    const ws = await readyAndPartial(onFinal)
    expect(typeof processor.onaudioprocess).toBe('function')
    const loud = {
      inputBuffer: { getChannelData: () => Float32Array.from({ length: 2048 }, () => 0.2) },
    }
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'like log in there?',
        speech_final: true,
      }),
    })
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS - 100)
    processor.onaudioprocess(loud)
    await vi.advanceTimersByTimeAsync(200)
    expect(onFinal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(STT_COMMIT_QUIET_MS + 200)
    expect(onFinal).toHaveBeenCalledTimes(1)
  })

  it('commits a finished sentence on mute and discards a fragment', () => {
    expect(shouldCommitOnMute("I'm")).toBe(false)
    expect(shouldCommitOnMute('Hey')).toBe(false)
    expect(shouldCommitOnMute('check the s1 drive')).toBe(true)
    expect(shouldCommitOnMute("What's on my queue?")).toBe(true)
  })

  it('discardPending prevents a later hangover commit', async () => {
    const onFinal = vi.fn()
    const controller = startStreamingStt({ token: 'token', onFinal })
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    const ws = sockets[0]
    ws.onmessage({ data: JSON.stringify({ type: 'transcript.created' }) })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: "I'm",
        speech_final: true,
      }),
    })
    expect(controller.pendingText()).toBe("I'm")
    controller.discardPending()
    expect(controller.pendingText()).toBe('')
    await vi.advanceTimersByTimeAsync(STT_INCOMPLETE_HANGOVER_MS + 200)
    expect(onFinal).not.toHaveBeenCalled()
  })

  it('hintTurnComplete commits the last partial after a short mute delay', async () => {
    const onFinal = vi.fn()
    const controller = startStreamingStt({ token: 'token', onFinal })
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    const ws = sockets[0]
    ws.onmessage({ data: JSON.stringify({ type: 'transcript.created' }) })
    ws.onmessage({
      data: JSON.stringify({
        type: 'transcript.partial',
        text: 'check the s1 drive',
        speech_final: false,
      }),
    })
    controller.hintTurnComplete()
    expect(onFinal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(STT_MUTE_COMMIT_MS - 1)
    expect(onFinal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(onFinal).toHaveBeenCalledWith('check the s1 drive', expect.any(Object))
  })
})

describe('stitchHeard', () => {
  it('keeps a growing Grok transcript', () => {
    expect(stitchHeard('I want you to check', 'I want you to check this task')).toBe(
      'I want you to check this task',
    )
    expect(isTranscriptExtension('I want you to check', 'I want you to check this task')).toBe(true)
  })

  it('joins a reset mid-thought instead of dropping the first clause', () => {
    expect(stitchHeard('I want you to check', 'this five nine three six Pulse task')).toBe(
      'I want you to check this five nine three six Pulse task',
    )
    expect(isTranscriptExtension('I want you to check', 'this five nine three six Pulse task')).toBe(false)
  })

  it('does not duplicate an overlapping second clause', () => {
    expect(
      stitchHeard('I want you to check Whether you can', 'Whether you can SSH into s1'),
    ).toBe('I want you to check Whether you can SSH into s1')
  })
})
