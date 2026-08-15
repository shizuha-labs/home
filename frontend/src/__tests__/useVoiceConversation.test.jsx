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
  nextSpokenSentences,
  useVoiceConversation,
  VOICE_STREAM_BASE_BACKOFF_MS,
  VOICE_STREAM_MAX_RETRIES,
} from '../hooks/useVoice'
import MiniShizuhaChat from '../components/assistant/MiniShizuhaChat'
import LiveVoiceOverlay from '../components/assistant/LiveVoiceOverlay'

vi.mock('../utils/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}))

const startStreamingStt = vi.fn()
vi.mock('../utils/streamingStt', () => ({
  startStreamingStt: (...args) => startStreamingStt(...args),
}))

function makeController() {
  return { stop: vi.fn(), cancel: vi.fn() }
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

  it('flushes leftover text when the stream completes without punctuation', () => {
    const mid = nextSpokenSentences('almost there', '')
    expect(mid.sentences).toEqual([])
    const done = nextSpokenSentences('almost there', mid.spoken, { flushRemainder: true })
    expect(done.sentences).toEqual(['almost there'])
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

  it('renders the ChatGPT Live overlay with Live label and waveform control', () => {
    render(
      <LiveVoiceOverlay
        agentLabel="Hina"
        callState="listening"
        muted={false}
        lastHeard="hello"
        onToggleMute={() => {}}
        onEnd={() => {}}
      />,
    )
    expect(screen.getByTestId('live-voice-overlay')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByLabelText('End Live')).toBeInTheDocument()
    expect(screen.getByText(/Live with Hina/i)).toBeInTheDocument()
  })
})
