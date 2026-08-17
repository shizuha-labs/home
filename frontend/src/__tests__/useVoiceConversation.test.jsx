/**
 * CON-296 regression: voice-call failure UX + bounded retry.
 *
 * Real caller sequences under test:
 *   A. click → getUserMedia NotFoundError/NotAllowedError → terminal guidance, 0 auto-retries
 *   B. click → stream refused (×N) → bounded exp backoff → terminal + manual retry
 *
 * Also covers classifyVoiceError and the MiniShizuhaChat failure surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import {
  classifyVoiceError,
  isDuplicateUtterance,
  nextSpokenSentences,
  stripSpeakableMarkup,
  spokenCovers,
  isTalkAckText,
  isGhostTranscript,
  clampTtsSpeed,
  nextTtsSpeed,
  formatTtsSpeed,
  isEchoUtterance,
  echoTokenOverlap,
  readyToFlushSpokenSentences,
  shouldSurfaceHeard,
  isLiveFillerUtterance,
  normalizeHeardName,
  useVoiceConversation,
  speakText,
  VOICE_STREAM_BASE_BACKOFF_MS,
  VOICE_STREAM_MAX_RETRIES,
} from '../hooks/useVoice'
import MiniShizuhaChat from '../components/assistant/MiniShizuhaChat'
import LiveVoiceOverlay from '../components/assistant/LiveVoiceOverlay'

vi.mock('../utils/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}))

const startStreamingStt = vi.fn()
vi.mock('../utils/streamingStt', async () => {
  const actual = await vi.importActual('../utils/streamingStt')
  return {
    ...actual,
    startStreamingStt: (...args) => startStreamingStt(...args),
  }
})

function makeController(pending = '') {
  return {
    stop: vi.fn(),
    cancel: vi.fn(),
    setMicEnabled: vi.fn(),
    hintTurnComplete: vi.fn(),
    discardPending: vi.fn(),
    pendingText: vi.fn(() => pending),
  }
}

/** Fire onError from the most recent startStreamingStt call. */
function fireLastError(error) {
  const last = startStreamingStt.mock.calls.at(-1)
  expect(last).toBeTruthy()
  const opts = last[0]
  act(() => {
    opts.onError?.(error)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  startStreamingStt.mockReset()
  startStreamingStt.mockImplementation(() => makeController())
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('classifyVoiceError', () => {
  it('classifies getUserMedia NotFoundError as no_mic', () => {
    expect(classifyVoiceError({ name: 'NotFoundError' })).toBe('no_mic')
    expect(classifyVoiceError({ name: 'DevicesNotFoundError' })).toBe('no_mic')
    expect(classifyVoiceError({ message: 'Requested device not found' })).toBe('no_mic')
  })

  it('classifies permission denials as permission_denied', () => {
    expect(classifyVoiceError({ name: 'NotAllowedError' })).toBe('permission_denied')
    expect(classifyVoiceError({ name: 'PermissionDeniedError' })).toBe('permission_denied')
    expect(classifyVoiceError({ name: 'SecurityError' })).toBe('permission_denied')
    expect(classifyVoiceError({ message: 'Permission denied' })).toBe('permission_denied')
  })

  it('classifies everything else as stream_unavailable', () => {
    expect(classifyVoiceError({ name: 'stream_unavailable', message: 'refused' })).toBe('stream_unavailable')
    expect(classifyVoiceError(new Error('websocket closed'))).toBe('stream_unavailable')
    expect(classifyVoiceError(null)).toBe('stream_unavailable')
  })
})

describe('isDuplicateUtterance', () => {
  it('ignores the same utterance inside the window', () => {
    expect(isDuplicateUtterance('I hear you twice.', 'I hear you twice.', 2000, 500, 2500)).toBe(true)
    expect(isDuplicateUtterance('I hear you twice.', 'I hear you twice.', 4000, 500, 2500)).toBe(false)
    expect(isDuplicateUtterance('hello', 'goodbye', 800, 500, 2500)).toBe(false)
  })
})

describe('spokenCovers', () => {
  it('treats a spoken prefix as already covered after whitespace normalize', () => {
    expect(spokenCovers('Hey Hritik. All good here.', 'Hey Hritik.')).toBe(true)
    expect(spokenCovers('Hey Hritik. All good here.', '  Hey   Hritik.  ')).toBe(true)
    expect(spokenCovers('Hey Hritik.', 'Something else.')).toBe(false)
  })
})

describe('nextSpokenSentences', () => {
  it('flushes complete sentences and remembers the spoken prefix', () => {
    const first = nextSpokenSentences('Hello there. More', '')
    expect(first.sentences).toEqual(['Hello there.'])
    const second = nextSpokenSentences('Hello there. More to come!', first.spoken)
    expect(second.sentences).toEqual(['More to come!'])
  })

  it('flushes short talk-seat replies like pong.', () => {
    const first = nextSpokenSentences('pong.', '')
    expect(first.sentences).toEqual(['pong.'])
  })

  it('does not treat leaked tool_call storms as speakable', () => {
    expect(stripSpeakableMarkup(
      "I'll look up Hive. <tool_call>ToolSearch</tool_call> <tool_call>ToolSearch</tool_call>",
    )).toBe("I'll look up Hive.")
  })

  it('flushes leftover text when the stream completes without punctuation', () => {
    const mid = nextSpokenSentences('almost there', '')
    expect(mid.sentences).toEqual([])
    const done = nextSpokenSentences('almost there', mid.spoken, { flushRemainder: true })
    expect(done.sentences).toEqual(['almost there'])
  })
})

describe('TTS talk speed', () => {
  it('clamps to the Grok 0.7–1.5 range and cycles 1 / 1.2 / 1.4', () => {
    expect(clampTtsSpeed(0.1)).toBe(0.7)
    expect(clampTtsSpeed(9)).toBe(1.5)
    expect(clampTtsSpeed('nope')).toBe(1.2)
    expect(nextTtsSpeed(1)).toBe(1.2)
    expect(nextTtsSpeed(1.2)).toBe(1.4)
    expect(nextTtsSpeed(1.4)).toBe(1)
    expect(formatTtsSpeed(1.2)).toBe('1.2×')
  })
})

describe('talk-seat transcript hygiene', () => {
  it('drops Replied. acks and Keyterms dumps', () => {
    expect(isTalkAckText('Replied.')).toBe(true)
    expect(isTalkAckText('Hey. I am here.')).toBe(false)
    expect(isGhostTranscript('Keyterms: Shizuha, Hritik, Hive, Cortex, Pulse')).toBe(true)
    expect(isGhostTranscript('Hive.')).toBe(true)
    expect(isGhostTranscript("Hey, what's up?")).toBe(false)
    expect(normalizeHeardName('Hey, Nawa, what\'s up?')).toBe('Hey, Ena, what\'s up?')
  })

  it('treats isolated Hive after TTS as echo', () => {
    const spokenAt = 1_000
    expect(isEchoUtterance('Hive.', 'Here. What\'s up?', 1_500, spokenAt)).toBe(true)
    expect(isEchoUtterance('What tasks are pending on me?', 'Here. What\'s up?', 1_500, spokenAt)).toBe(false)
    expect(isEchoUtterance('Hive.', 'Here. What\'s up?', 10_000, spokenAt)).toBe(true)
  })

  it('drops a paraphrased echo of the last spoken question', () => {
    const spokenAt = 1_000
    expect(echoTokenOverlap('What can I do?', "Hey. I'm here. What do you need?")).toBeGreaterThanOrEqual(0.45)
    expect(isEchoUtterance('What can I do?', "Hey. I'm here. What do you need?", 8_000, spokenAt)).toBe(true)
    expect(isEchoUtterance('Ping Raunak about BKSG-48.', "Hey. I'm here. What do you need?", 8_000, spokenAt)).toBe(false)
  })

  it('does not surface mute fragments or question paraphrases as heard text', () => {
    expect(shouldSurfaceHeard("I'm", { muted: true }).ok).toBe(false)
    expect(['muted_fragment', 'filler']).toContain(shouldSurfaceHeard("I'm", { muted: true }).reason)
    expect(shouldSurfaceHeard('What can I do?', {
      lastSpoken: "Hey. I'm here. What do you need?",
      spokenAt: 1_000,
      now: 8_000,
    }).ok).toBe(false)
    expect(shouldSurfaceHeard('Ping Raunak about BKSG-48.', {
      lastSpoken: "Hey. I'm here. What do you need?",
      spokenAt: 1_000,
      now: 8_000,
    }).ok).toBe(true)
    expect(shouldSurfaceHeard('check the s1 drive', { muted: true }).ok).toBe(true)
  })

  it('drops Good / Good here as Live filler, not as a real turn', () => {
    expect(isLiveFillerUtterance('Good.')).toBe(true)
    expect(isLiveFillerUtterance('Good here')).toBe(true)
    expect(isLiveFillerUtterance("I'm here")).toBe(true)
    expect(isLiveFillerUtterance('the drive')).toBe(false)
    expect(isLiveFillerUtterance('BKSG-48')).toBe(false)
    expect(shouldSurfaceHeard('Good.', {
      lastSpoken: 'Want to walk BKSG-48 or the drive?',
      spokenAt: 1_000,
      now: 50_000,
    })).toMatchObject({ ok: false, reason: 'filler' })
    expect(shouldSurfaceHeard('the drive', {
      lastSpoken: 'Want to walk BKSG-48 or the drive?',
      spokenAt: 1_000,
      now: 50_000,
    }).ok).toBe(true)
  })

  it('holds the first Live flush until a real phrase lands', () => {
    expect(readyToFlushSpokenSentences('', 'Hey.', false)).toBe(false)
    expect(readyToFlushSpokenSentences('', "Hey. I'm here. What do you need?", false)).toBe(true)
    expect(readyToFlushSpokenSentences('', 'Hey.', true)).toBe(true)
    expect(readyToFlushSpokenSentences('Hey. ', 'More text.', false)).toBe(true)
  })
})

describe('useVoiceConversation — utterance dedupe', () => {
  it('does not inject Keyterms dumps or Hive echo as utterances', () => {
    const onUtterance = vi.fn()
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onFinal?.('Keyterms: Shizuha, Hritik, Hive, Cortex, Pulse')
    })
    expect(onUtterance).not.toHaveBeenCalled()
  })

  it('does not re-send the same final transcript within the window', () => {
    const onUtterance = vi.fn()
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onFinal?.("I'm actually hearing a voice twice.")
      opts.onFinal?.("I'm actually hearing a voice twice.")
    })
    expect(onUtterance).toHaveBeenCalledTimes(1)
  })

  it('clears Speaking and re-opens the mic after endSpeak', async () => {
    const { result } = renderHook(() => useVoiceConversation())
    act(() => {
      result.current.startCall()
    })
    act(() => {
      result.current.beginSpeak('Hey. I am here.')
    })
    expect(result.current.callState).toBe('speaking')
    await act(async () => {
      await result.current.endSpeak()
    })
    expect(result.current.callState).not.toBe('speaking')
    expect(['listening', 'connecting']).toContain(result.current.callState)
    expect(startStreamingStt.mock.calls.length).toBeGreaterThan(1)
  })

  it('cancelSpeak cuts TTS immediately and leaves Speaking without waiting', () => {
    const stop = vi.spyOn(speakText, 'stop')
    const { result } = renderHook(() => useVoiceConversation())
    act(() => {
      result.current.startCall()
    })
    act(() => {
      result.current.beginSpeak('A long reply that should be cut off.')
    })
    expect(result.current.callState).toBe('speaking')
    const callsBefore = startStreamingStt.mock.calls.length
    act(() => {
      result.current.cancelSpeak()
    })
    expect(stop).toHaveBeenCalled()
    expect(result.current.callState).not.toBe('speaking')
    expect(['listening', 'connecting']).toContain(result.current.callState)
    expect(startStreamingStt.mock.calls.length).toBeGreaterThan(callsBefore)
    stop.mockRestore()
  })

  it('mute only silences the mic and still delivers a finished in-flight utterance', () => {
    const onUtterance = vi.fn()
    startStreamingStt.mockImplementation(() => makeController('check the s1 drive'))
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    const first = startStreamingStt.mock.results[0]?.value
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onPartial?.('check the s1 drive')
    })
    act(() => {
      result.current.toggleMute()
    })
    expect(first.cancel).not.toHaveBeenCalled()
    expect(first.setMicEnabled).toHaveBeenCalledWith(false)
    expect(first.hintTurnComplete).toHaveBeenCalled()
    expect(first.discardPending).not.toHaveBeenCalled()
    act(() => {
      opts.onFinal?.('check the s1 drive')
    })
    expect(onUtterance).toHaveBeenCalledWith('check the s1 drive')
    expect(result.current.muted).toBe(true)
  })

  it('reopens listen with leftover text when STT ends mid-sentence', () => {
    const onUtterance = vi.fn()
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    const first = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      first.onDone?.({
        hold: true,
        text: 'can you check into S one like log in there',
        holdCount: 1,
      })
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(startStreamingStt.mock.calls.length).toBeGreaterThan(1)
    expect(startStreamingStt.mock.calls.at(-1)[0].seed).toMatch(/log in there/)
    expect(onUtterance).not.toHaveBeenCalled()
  })

  it('does not send Good. after a long reply even outside the echo window', async () => {
    const onUtterance = vi.fn()
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    act(() => {
      result.current.beginSpeak('Want to walk BKSG-48 or the drive?')
    })
    await act(async () => {
      await result.current.endSpeak()
    })
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onPartial?.('Good.')
    })
    expect(result.current.lastHeard).not.toMatch(/^good/i)
    act(() => {
      opts.onFinal?.('Good.')
    })
    expect(onUtterance).not.toHaveBeenCalled()
    act(() => {
      opts.onFinal?.('Good here')
    })
    expect(onUtterance).not.toHaveBeenCalled()
  })

  it('does not paint or send a paraphrased echo after she just spoke', async () => {
    const onUtterance = vi.fn()
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    act(() => {
      result.current.beginSpeak("Hey. I'm here. What do you need?")
    })
    await act(async () => {
      await result.current.endSpeak()
    })
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onPartial?.('What can I do?')
    })
    expect(result.current.lastHeard).not.toMatch(/what can i do/i)
    act(() => {
      opts.onFinal?.('What can I do?')
    })
    expect(onUtterance).not.toHaveBeenCalled()
    expect(result.current.lastHeard).not.toMatch(/what can i do/i)
  })

  it('mute discards a fragment like I\'m and does not send it', () => {
    const onUtterance = vi.fn()
    startStreamingStt.mockImplementation(() => makeController("I'm"))
    const { result } = renderHook(() => useVoiceConversation({ onUtterance }))
    act(() => {
      result.current.startCall()
    })
    const first = startStreamingStt.mock.results[0]?.value
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onPartial?.("I'm")
    })
    act(() => {
      result.current.toggleMute()
    })
    expect(first.setMicEnabled).toHaveBeenCalledWith(false)
    expect(first.hintTurnComplete).not.toHaveBeenCalled()
    expect(first.discardPending).toHaveBeenCalled()
    act(() => {
      opts.onFinal?.("I'm")
    })
    expect(onUtterance).not.toHaveBeenCalled()
    expect(result.current.muted).toBe(true)
  })

  it('cancels the mic when a reply starts speaking', async () => {
    const { result } = renderHook(() => useVoiceConversation())
    act(() => {
      result.current.startCall()
    })
    const first = startStreamingStt.mock.results[0]?.value
    await act(async () => {
      await result.current.notifyReply('pong.')
    })
    expect(first.cancel).toHaveBeenCalled()
  })
})

describe('useVoiceConversation — streaming STT captions', () => {
  it('types partial transcripts into lastHeard as the user speaks', () => {
    const { result } = renderHook(() => useVoiceConversation())
    act(() => {
      result.current.startCall()
    })
    const opts = startStreamingStt.mock.calls.at(-1)[0]
    act(() => {
      opts.onPartial?.('hello there')
    })
    expect(result.current.lastHeard).toBe('hello there')
    act(() => {
      opts.onPartial?.('hello there Hina')
    })
    expect(result.current.lastHeard).toBe('hello there Hina')
  })
})

describe('useVoiceConversation — CON-296 failure paths', () => {
  it('A: NotFoundError hard-fails with guidance and never auto-retries', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(1)
    expect(result.current.callState).toBe('connecting')

    fireLastError({ name: 'NotFoundError', message: 'Requested device not found' })

    expect(result.current.callState).toBe('error')
    expect(result.current.callError).toEqual({
      kind: 'no_mic',
      message: 'No microphone found. Connect a mic or type instead.',
      canRetry: false,
    })

    // Advance well past any historical 400ms retry storm window.
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(1)
    expect(result.current.callState).toBe('error')
  })

  it('A: NotAllowedError hard-fails with permission guidance and never auto-retries', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    fireLastError({ name: 'NotAllowedError', message: 'Permission denied' })

    expect(result.current.callState).toBe('error')
    expect(result.current.callError).toMatchObject({
      kind: 'permission_denied',
      canRetry: false,
    })
    expect(result.current.callError.message).toMatch(/permission denied/i)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(1)
  })

  it('B: stream_unavailable retries with exponential backoff then terminals with manual retry', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(1)

    // Attempt 1 fails → schedule retry #1 after 500ms
    fireLastError({ name: 'stream_unavailable', message: 'refused' })
    expect(result.current.callState).toBe('connecting')
    expect(result.current.callError).toBeNull()
    expect(startStreamingStt).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(VOICE_STREAM_BASE_BACKOFF_MS - 1)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(2)

    // Attempt 2 fails → retry #2 after 1000ms
    fireLastError({ name: 'stream_unavailable', message: 'refused' })
    act(() => {
      vi.advanceTimersByTime(VOICE_STREAM_BASE_BACKOFF_MS * 2)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(3)

    // Attempt 3 fails → retry #3 after 2000ms
    fireLastError({ name: 'stream_unavailable', message: 'refused' })
    act(() => {
      vi.advanceTimersByTime(VOICE_STREAM_BASE_BACKOFF_MS * 4)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(4)

    // Attempt 4 fails → budget exhausted (1 initial + MAX_RETRIES)
    fireLastError({ name: 'stream_unavailable', message: 'refused' })
    expect(result.current.callState).toBe('error')
    expect(result.current.callError).toEqual({
      kind: 'stream_unavailable',
      message: 'Voice is temporarily unavailable. Try again in a moment.',
      canRetry: true,
    })

    // No further automatic attempts after terminal error.
    const terminalCalls = startStreamingStt.mock.calls.length
    expect(terminalCalls).toBe(1 + VOICE_STREAM_MAX_RETRIES)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(terminalCalls)
  })

  it('B: manual retryCall restarts the stream after a terminal stream failure', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    // Exhaust the budget immediately by failing MAX_RETRIES+1 times with zero delay
    // (fire errors + advance each backoff).
    for (let i = 0; i < VOICE_STREAM_MAX_RETRIES; i += 1) {
      fireLastError({ name: 'stream_unavailable' })
      act(() => {
        vi.advanceTimersByTime(VOICE_STREAM_BASE_BACKOFF_MS * (2 ** i))
      })
    }
    fireLastError({ name: 'stream_unavailable' })
    expect(result.current.callState).toBe('error')
    expect(result.current.callError?.canRetry).toBe(true)
    const beforeManual = startStreamingStt.mock.calls.length

    act(() => {
      result.current.retryCall()
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(beforeManual + 1)
    expect(result.current.callState).toBe('connecting')
    expect(result.current.callError).toBeNull()
  })

  it('stops the in-flight controller on endCall and cancels a pending stream retry', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    // Capture the controller the hook actually stored (mockImplementation makes a fresh one).
    const firstController = startStreamingStt.mock.results[0]?.value
    expect(firstController).toBeTruthy()

    // endCall while still connecting → teardownCapture cancels the live controller.
    act(() => {
      result.current.endCall()
    })
    expect(firstController.cancel).toHaveBeenCalled()
    expect(result.current.callState).toBe('idle')

    // Fresh call, then a stream error schedules a backoff retry — endCall must
    // clear that timer so no further startStreamingStt fires.
    act(() => {
      result.current.startCall()
    })
    fireLastError({ name: 'stream_unavailable' })
    expect(result.current.callState).toBe('connecting')
    const callsAfterError = startStreamingStt.mock.calls.length

    act(() => {
      result.current.endCall()
    })
    expect(result.current.callState).toBe('idle')
    expect(result.current.callError).toBeNull()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(callsAfterError)
  })

  it('does not consume the stream-retry budget on silence re-listen (onDone)', () => {
    const { result } = renderHook(() => useVoiceConversation())

    act(() => {
      result.current.startCall()
    })
    const opts = startStreamingStt.mock.calls[0][0]
    act(() => {
      opts.onState?.('listening')
    })
    expect(result.current.callState).toBe('listening')

    // Silence close → re-arm after 250ms without counting as a failure.
    act(() => {
      opts.onDone?.()
    })
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(2)

    // A subsequent stream failure still has the full retry budget.
    fireLastError({ name: 'stream_unavailable' })
    act(() => {
      vi.advanceTimersByTime(VOICE_STREAM_BASE_BACKOFF_MS)
    })
    expect(startStreamingStt).toHaveBeenCalledTimes(3)
    expect(result.current.callState).not.toBe('error')
  })
})

describe('MiniShizuhaChat — voice failure surface', () => {
  it('hides Replied leftovers and keeps the strip scrollable', () => {
    render(
      <MiniShizuhaChat
        messages={[
          { id: '1', sender_id: 1, content: "Yo, what's up?" },
          { id: '2', sender_id: 2, sender_name: 'Ena', content: "Hey. I'm here. What do you need?" },
          { id: '3', sender_id: 2, sender_name: 'Ena', content: 'Replied.' },
          { id: '4', sender_id: 2, sender_name: 'Ena', content: 'Keyterms: Shizuha, Hritik, Hive' },
        ]}
        typingUsers={[]}
        currentUserId={1}
        isLoading={false}
        onOpenFull={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/yo, what's up/i)).toBeInTheDocument()
    expect(screen.getByText(/hey\. i'm here/i)).toBeInTheDocument()
    expect(screen.queryByText(/^replied\.?$/i)).toBeNull()
    expect(screen.queryByText(/keyterms?:/i)).toBeNull()
    expect(screen.getByTestId('mini-chat-scroll').className).toMatch(/overflow-y-auto/)
  })

  it('renders actionable no-mic guidance with Dismiss (no Retry)', () => {
    const onDismiss = vi.fn()
    render(
      <MiniShizuhaChat
        messages={[]}
        typingUsers={[]}
        currentUserId={1}
        isLoading={false}
        onOpenFull={() => {}}
        onClose={() => {}}
        callState="error"
        callError={{
          kind: 'no_mic',
          message: 'No microphone found. Connect a mic or type instead.',
          canRetry: false,
        }}
        onDismissCallError={onDismiss}
      />,
    )

    const alert = screen.getByTestId('voice-call-error')
    expect(alert).toHaveTextContent(/no microphone found/i)
    expect(screen.getByText('Voice unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    screen.getByRole('button', { name: /dismiss/i }).click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders stream-unavailable guidance with Retry', () => {
    const onRetry = vi.fn()
    render(
      <MiniShizuhaChat
        messages={[]}
        typingUsers={[]}
        currentUserId={1}
        isLoading={false}
        onOpenFull={() => {}}
        onClose={() => {}}
        callState="error"
        callError={{
          kind: 'stream_unavailable',
          message: 'Voice is temporarily unavailable. Try again in a moment.',
          canRetry: true,
        }}
        onRetryCall={onRetry}
      />,
    )

    expect(screen.getByTestId('voice-call-error')).toHaveTextContent(/temporarily unavailable/i)
    screen.getByRole('button', { name: /retry/i }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders a non-blocking live HUD that leaves dashboard and compose usable', () => {
    const onDash = vi.fn()
    render(
      <div>
        <nav>
          <button type="button" onClick={onDash}>Dashboard</button>
        </nav>
        <textarea aria-label="Message Ena" />
        <LiveVoiceOverlay
          agentLabel="Hina"
          callState="listening"
          muted={false}
          lastHeard="hello"
          speakEnabled
          onToggleSpeak={() => {}}
          onToggleMute={() => {}}
          onEnd={() => {}}
          ttsSpeed={1.2}
          onCycleSpeed={() => {}}
        />
      </div>,
    )
    const hud = screen.getByTestId('live-voice-overlay')
    expect(hud).toBeInTheDocument()
    expect(hud).toHaveAttribute('data-mode', 'hud')
    expect(hud).toHaveClass('pointer-events-none')
    expect(hud.className).toMatch(/top-\[7\.5rem\]/)
    expect(hud.className).not.toMatch(/\binset-0\b/)
    expect(screen.getByTestId('hud-speak-button')).toHaveAttribute('title', 'Voice replies on')
    expect(screen.getByRole('region', { name: /live voice/i })).toHaveClass('bg-gray-950')
    expect(screen.getByRole('region', { name: /live voice/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByLabelText('End Live')).toBeInTheDocument()
    expect(screen.getByText(/Live with Hina/i)).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByTestId('tts-speed-button')).toHaveTextContent('1.2×')
    screen.getByRole('button', { name: 'Dashboard' }).click()
    expect(onDash).toHaveBeenCalledOnce()
    const compose = screen.getByLabelText('Message Ena')
    compose.focus()
    expect(document.activeElement).toBe(compose)
  })

  it('shows Retry on the live HUD when the call fails', () => {
    const onRetry = vi.fn()
    render(
      <LiveVoiceOverlay
        agentLabel="Yuna"
        callState="error"
        error="Voice is temporarily unavailable."
        onToggleMute={() => {}}
        onEnd={() => {}}
        onRetry={onRetry}
      />,
    )
    screen.getByRole('button', { name: /retry/i }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
