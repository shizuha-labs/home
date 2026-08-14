import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'
import { startStreamingStt } from '../utils/streamingStt'

/**
 * Voice layer for the home mini-chat (operator 2026-07-11).
 *
 * Layered strategy so voice works immediately AND upgrades transparently:
 *  1. Self-hosted voice service (when deployed): POST /voice/api/stt
 *     (audio/webm → {text}) and POST /voice/api/tts ({text} → audio stream).
 *     Planned models: faster-whisper large-v3-turbo (STT) + Kokoro-82M (TTS),
 *     both on our own GPUs — nothing leaves the platform.
 *  2. Browser fallback: SpeechRecognition (STT) + speechSynthesis (TTS).
 *
 * The service probe is cached per session; a 404/503 silently selects the
 * browser path, so shipping the frontend first is safe.
 */

let sttServiceAvailable = null // null = unprobed
async function probeVoiceService() {
  if (sttServiceAvailable !== null) return sttServiceAvailable
  try {
    const res = await fetch('/voice/api/health', { method: 'GET' })
    sttServiceAvailable = res.ok
  } catch {
    sttServiceAvailable = false
  }
  return sttServiceAvailable
}

const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined

export function useVoiceInput({ onTranscript } = {}) {
  const [micState, setMicState] = useState('idle') // idle | connecting | listening | transcribing
  const recognitionRef = useRef(null)
  const streamingRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const micSupported =
    typeof navigator !== 'undefined' &&
    (!!SpeechRecognitionImpl || !!navigator.mediaDevices?.getUserMedia)

  const stopAll = useCallback(() => {
    try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    recognitionRef.current = null
    streamingRef.current?.stop()
    streamingRef.current = null
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      try { mr.stop() } catch { /* already stopped */ }
    }
  }, [])

  const cancelAll = useCallback(() => {
    try { recognitionRef.current?.abort() } catch { /* already stopped */ }
    recognitionRef.current = null
    streamingRef.current?.cancel()
    streamingRef.current = null
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.onstop = null
      try { mr.stop() } catch { /* already stopped */ }
      mr.stream?.getTracks().forEach((track) => track.stop())
    }
    mediaRecorderRef.current = null
  }, [])

  const startBrowserRecognition = useCallback(() => {
    const rec = new SpeechRecognitionImpl()
    recognitionRef.current = rec
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = false // auto-finalize on silence → natural "send"
    let finalText = ''
    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      if (interim && !finalText) onTranscriptRef.current?.(interim, { final: false })
    }
    rec.onerror = () => setMicState('idle')
    rec.onend = () => {
      setMicState('idle')
      recognitionRef.current = null
      const text = finalText.trim()
      if (text) onTranscriptRef.current?.(text, { final: true })
    }
    rec.start()
    setMicState('listening')
  }, [])

  const startServerRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
    mediaRecorderRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef.current = null
      const blob = new Blob(chunksRef.current, { type: mr.mimeType })
      chunksRef.current = []
      if (blob.size < 1000) { setMicState('idle'); return } // too short — ignore
      setMicState('transcribing')
      try {
        const form = new FormData()
        form.append('audio', blob, 'speech.webm')
        const res = await fetch('/voice/api/stt', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: form,
        })
        if (res.ok) {
          const data = await res.json()
          const text = (data.text || '').trim()
          if (text) onTranscriptRef.current?.(text, { final: true })
        }
      } catch { /* transcription failed — leave input untouched */ }
      setMicState('idle')
    }
    mr.start()
    setMicState('listening')
  }, [])

  const startServerStreaming = useCallback(() => {
    const controller = startStreamingStt({
      token: getAccessToken(),
      onState: setMicState,
      onPartial: (text) => onTranscriptRef.current?.(text, { final: false }),
      onFinal: (text) => {
        streamingRef.current = null
        onTranscriptRef.current?.(text, { final: true })
      },
      onError: (_error, { ready }) => {
        streamingRef.current = null
        setMicState('idle')
        // The batch upload path remains the fail-soft fallback while the
        // streaming route/provider is unavailable.
        if (!ready) startServerRecording().catch(() => setMicState('idle'))
      },
    })
    streamingRef.current = controller
  }, [startServerRecording])

  const toggleMic = useCallback(async () => {
    if (micState === 'connecting' || micState === 'listening') { stopAll(); return }
    if (micState === 'transcribing') return
    try {
      const serverReady = await probeVoiceService()
      if (serverReady && navigator.mediaDevices?.getUserMedia) {
        startServerStreaming()
      } else if (SpeechRecognitionImpl) {
        startBrowserRecognition()
      }
    } catch {
      // Mic permission denied or recognition unavailable.
      setMicState('idle')
    }
  }, [micState, startBrowserRecognition, startServerStreaming, stopAll])

  useEffect(() => () => cancelAll(), [cancelAll])

  return { micState, micSupported, toggleMic }
}

// ── TTS ──────────────────────────────────────────────────────────────────────

let currentAudio = null

/** Speak `text` aloud — self-hosted TTS when available, speechSynthesis
 * otherwise. Returns a promise that resolves when playback FINISHES (so a
 * voice-conversation loop can resume listening after the reply is spoken). */
export async function speakText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500)
  if (!clean) return
  speakText.stop()
  try {
    const serverReady = await probeVoiceService()
    if (serverReady) {
      const res = await fetch('/voice/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ text: clean }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudio = audio
        await new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
          audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
          audio.play().catch(() => resolve())
        })
        return
      }
    }
  } catch { /* fall through to browser voice */ }
  if (typeof speechSynthesis !== 'undefined') {
    await new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(clean)
      utter.rate = 1.05
      utter.onend = resolve
      utter.onerror = resolve
      speechSynthesis.speak(utter)
    })
  }
}

speakText.stop = () => {
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    currentAudio = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

// ── Hands-free voice conversation loop (operator 2026-07-11) ─────────────────
// listen (VAD auto-stop) → transcribe (grok STT) → onUtterance(text) → parent
// sends to Shizuha → notifyReply(text) speaks it (kokoro TTS) → resume listen.
// Voice-only; the mini-chat strip shows the rolling text alongside.
//
// CON-296: never silently retry-storm. Mic hard-fails (no device / permission)
// surface guidance with zero auto-retry. Server/stream failures get a small
// bounded exponential backoff, then a manual-retry error state. Every failed
// attempt fully disposes WS / AudioContext / mic tracks via startStreamingStt.

/** Max automatic reconnects after a server/stream failure (not counting the first try). */
export const VOICE_STREAM_MAX_RETRIES = 3
/** Base backoff for stream retries; doubles each attempt (500 → 1000 → 2000 ms). */
export const VOICE_STREAM_BASE_BACKOFF_MS = 500

const MIC_ERROR_MESSAGES = {
  no_mic: 'No microphone found. Connect a mic or type instead.',
  permission_denied: 'Microphone permission denied. Allow mic access in your browser settings, then try again.',
}

const STREAM_UNAVAILABLE_MESSAGE = 'Voice is temporarily unavailable. Try again in a moment.'

/**
 * Classify a streaming-STT / getUserMedia failure for UX + retry policy.
 * @returns {'no_mic'|'permission_denied'|'stream_unavailable'}
 */
export function classifyVoiceError(error) {
  const name = String(error?.name || '')
  const message = String(error?.message || '').toLowerCase()

  // getUserMedia DOMExceptions (and legacy webkit aliases)
  if (
    name === 'NotFoundError'
    || name === 'DevicesNotFoundError'
    || message.includes('requested device not found')
    || message.includes('no microphone')
  ) {
    return 'no_mic'
  }
  if (
    name === 'NotAllowedError'
    || name === 'PermissionDeniedError'
    || name === 'SecurityError'
    || message.includes('permission denied')
    || message.includes('not allowed')
  ) {
    return 'permission_denied'
  }

  // Everything else (stream_unavailable, WS drop, missing token, …) is a
  // transient server/stream class — bounded retry, then manual retry.
  return 'stream_unavailable'
}

export function useVoiceConversation({ onUtterance } = {}) {
  // idle | connecting | listening | thinking | speaking | error
  const [callState, setCallState] = useState('idle')
  // { kind, message, canRetry } | null — only set when callState === 'error'
  const [callError, setCallError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [lastHeard, setLastHeard] = useState('')
  const activeRef = useRef(false)
  const mutedRef = useRef(false)
  const speakingRef = useRef(false)
  const streamingRef = useRef(null)
  const onUtteranceRef = useRef(onUtterance)
  onUtteranceRef.current = onUtterance
  const listenOnceRef = useRef(null)
  const streamAttemptsRef = useRef(0) // failed stream attempts in the current call
  const retryTimerRef = useRef(null)
  const silenceTimerRef = useRef(null)

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const teardownCapture = useCallback(() => {
    streamingRef.current?.cancel()
    streamingRef.current = null
  }, [])

  const failCall = useCallback((kind, message, canRetry) => {
    activeRef.current = false
    speakingRef.current = false
    clearTimers()
    teardownCapture()
    speakText.stop()
    streamAttemptsRef.current = 0
    setCallError({ kind, message, canRetry: !!canRetry })
    setCallState('error')
  }, [clearTimers, teardownCapture])

  const scheduleStreamRetry = useCallback(() => {
    const failed = streamAttemptsRef.current + 1
    streamAttemptsRef.current = failed
    if (failed > VOICE_STREAM_MAX_RETRIES) {
      failCall('stream_unavailable', STREAM_UNAVAILABLE_MESSAGE, true)
      return
    }
    // Still in the call — show connecting while we back off.
    setCallState('connecting')
    setCallError(null)
    const delay = VOICE_STREAM_BASE_BACKOFF_MS * (2 ** (failed - 1))
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current)
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      if (activeRef.current) listenOnceRef.current?.()
    }, delay)
  }, [failCall])

  const listenOnce = useCallback(() => {
    if (!activeRef.current || mutedRef.current) return
    clearTimers()
    setCallError(null)
    if (!speakingRef.current) setCallState('connecting')
    let utteranceDelivered = false
    try {
      const controller = startStreamingStt({
        token: getAccessToken(),
        onState: (state) => {
          if (!activeRef.current || mutedRef.current) return
          // Promote connecting → listening once the stream is live. Ignore
          // 'idle'/'transcribing' here — conversation owns those transitions.
          if (state === 'listening') {
            // A live listen means the stream path worked; reset the failure budget.
            streamAttemptsRef.current = 0
            if (!speakingRef.current) setCallState('listening')
          } else if (state === 'connecting' && !speakingRef.current) {
            setCallState('connecting')
          }
        },
        onPartial: () => {},
        onFinal: (text) => {
          streamingRef.current = null
          if (!activeRef.current || mutedRef.current || !text.trim()) return
          utteranceDelivered = true
          streamAttemptsRef.current = 0
          const heard = text.trim()
          setLastHeard(heard)
          if (speakingRef.current) {
            speakingRef.current = false
            speakText.stop()
          }
          setCallState('thinking')
          onUtteranceRef.current?.(heard)
        },
        onDone: () => {
          // Successful stream close with no utterance (silence) — re-arm listen
          // once. This is the conversation loop, not a failure path, so it does
          // not consume the stream-retry budget.
          if (activeRef.current && !utteranceDelivered) {
            if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null
              if (activeRef.current) listenOnceRef.current?.()
            }, 250)
          }
        },
        onError: (error) => {
          streamingRef.current = null
          // startStreamingStt already disposed WS/AudioContext/mic tracks.
          if (!activeRef.current) return
          const kind = classifyVoiceError(error)
          if (kind === 'no_mic' || kind === 'permission_denied') {
            // Hard fail — never auto-retry mic/permission errors (CON-296 A).
            failCall(kind, MIC_ERROR_MESSAGES[kind], false)
            return
          }
          // Server/stream failure — bounded exponential backoff (CON-296 B).
          scheduleStreamRetry()
        },
      })
      streamingRef.current = controller
    } catch (error) {
      streamingRef.current = null
      if (!activeRef.current) return
      const kind = classifyVoiceError(error)
      if (kind === 'no_mic' || kind === 'permission_denied') {
        failCall(kind, MIC_ERROR_MESSAGES[kind], false)
      } else {
        scheduleStreamRetry()
      }
    }
  }, [clearTimers, failCall, scheduleStreamRetry])
  listenOnceRef.current = listenOnce

  // Parent calls this when Shizuha's reply text arrives → speak, then re-listen.
  // Live keeps the mic open so the caller can barge in (ChatGPT Live duplex).
  const notifyReply = useCallback(async (text) => {
    if (!activeRef.current || !text) return
    speakingRef.current = true
    setCallState('speaking')
    if (!mutedRef.current && !streamingRef.current) listenOnceRef.current?.()
    await speakText(text)
    speakingRef.current = false
    if (activeRef.current && !mutedRef.current) listenOnceRef.current?.()
  }, [])

  const startCall = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    mutedRef.current = false
    speakingRef.current = false
    streamAttemptsRef.current = 0
    setMuted(false)
    setLastHeard('')
    setCallError(null)
    listenOnceRef.current?.()
  }, [])

  const endCall = useCallback(() => {
    activeRef.current = false
    mutedRef.current = false
    speakingRef.current = false
    clearTimers()
    teardownCapture()
    speakText.stop()
    streamAttemptsRef.current = 0
    setMuted(false)
    setLastHeard('')
    setCallError(null)
    setCallState('idle')
  }, [clearTimers, teardownCapture])

  const toggleMute = useCallback(() => {
    if (!activeRef.current) return
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (next) {
      teardownCapture()
    } else {
      listenOnceRef.current?.()
    }
  }, [teardownCapture])

  /** Manual retry after a terminal stream_unavailable error (or user re-tap). */
  const retryCall = useCallback(() => {
    activeRef.current = false
    mutedRef.current = false
    speakingRef.current = false
    clearTimers()
    teardownCapture()
    speakText.stop()
    streamAttemptsRef.current = 0
    setMuted(false)
    setCallError(null)
    activeRef.current = true
    listenOnceRef.current?.()
  }, [clearTimers, teardownCapture])

  useEffect(() => () => {
    activeRef.current = false
    mutedRef.current = false
    speakingRef.current = false
    clearTimers()
    teardownCapture()
    speakText.stop()
  }, [clearTimers, teardownCapture])

  return {
    callState,
    callError,
    muted,
    lastHeard,
    startCall,
    endCall,
    retryCall,
    toggleMute,
    notifyReply,
    isCallActive: () => activeRef.current,
  }
}
