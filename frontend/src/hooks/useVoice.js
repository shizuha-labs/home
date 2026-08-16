import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'
import { startStreamingStt } from '../utils/streamingStt'

/**
 * Voice layer for the home mini-chat (operator 2026-07-11).
 *
 * STT is streaming only (operator 2026-08-15): type on screen as the
 * caller speaks. Batch /voice/api/stt upload is gone. TTS still goes
 * through /voice/api/tts (Cortex/Grok first, Kokoro backup).
 *
 * Live call speak uses the Grok TTS websocket (speakDelta). Unary
 * /voice/api/tts is the fallback when the stream is down.
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
  }, [])

  const cancelAll = useCallback(() => {
    try { recognitionRef.current?.abort() } catch { /* already stopped */ }
    recognitionRef.current = null
    streamingRef.current?.cancel()
    streamingRef.current = null
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

  const startServerStreaming = useCallback(() => {
    const controller = startStreamingStt({
      token: getAccessToken(),
      onState: setMicState,
      onPartial: (text) => onTranscriptRef.current?.(text, { final: false }),
      onFinal: (text) => {
        streamingRef.current = null
        onTranscriptRef.current?.(text, { final: true })
      },
      onError: () => {
        streamingRef.current = null
        setMicState('idle')
      },
    })
    streamingRef.current = controller
  }, [])

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
  stopSpeakStream()
}

// ── Streaming TTS (Grok WS via /voice/api/tts/stream, Kokoro backup) ────────
let speakWs = null
let speakReady = null
let speakQueue = Promise.resolve()
let streamingTtsAvailable = null // null = unprobed

async function probeStreamingTts() {
  if (streamingTtsAvailable !== null) return streamingTtsAvailable
  try {
    const res = await fetch('/voice/api/health', { method: 'GET' })
    if (!res.ok) {
      streamingTtsAvailable = false
      return false
    }
    const body = await res.json()
    // Older images have no streaming_tts field — treat missing as unavailable
    // so we do not sit on a 4s WS handshake to a route that 403s.
    streamingTtsAvailable = !!body?.streaming_tts?.available
  } catch {
    streamingTtsAvailable = false
  }
  return streamingTtsAvailable
}

function playAudioChunk(b64, mime = 'audio/mpeg') {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  currentAudio = audio
  return new Promise((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
    audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
    audio.play().catch(() => resolve())
  })
}

function stopSpeakStream() {
  if (speakWs) {
    try { speakWs.close() } catch { /* noop */ }
    speakWs = null
  }
  speakReady = null
}

export function startSpeakStream({ voice } = {}) {
  if (speakWs && speakWs.readyState === WebSocket.OPEN) return speakReady
  stopSpeakStream()
  speakReady = (async () => {
    const advertised = await probeStreamingTts()
    if (!advertised) return false
    return await new Promise((resolve) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/voice/api/tts/stream`)
      speakWs = ws
      const timer = setTimeout(() => resolve(false), 1500)
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'start',
          token: getAccessToken(),
          voice: voice || 'ara',
          language: 'en',
        }))
      }
      ws.onmessage = (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'ready') {
          clearTimeout(timer)
          resolve(true)
        } else if (msg.type === 'audio.delta' && msg.delta) {
          speakQueue = speakQueue.then(() => playAudioChunk(msg.delta, msg.mime || 'audio/mpeg'))
        }
      }
      ws.onerror = () => { clearTimeout(timer); resolve(false) }
      ws.onclose = () => {
        if (speakWs === ws) speakWs = null
        clearTimeout(timer)
        resolve(false)
      }
    })
  })()
  return speakReady
}

export function stripSpeakableMarkup(text) {
  return String(text || '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/<\/?tool_call\b[^>]*>/gi, ' ')
    .replace(/<invoke\b[\s\S]*?<\/invoke>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function speakDelta(text, { done = true } = {}) {
  const clean = stripSpeakableMarkup(text)
  if (!clean) return
  const ready = await startSpeakStream()
  if (!ready || !speakWs || speakWs.readyState !== WebSocket.OPEN) {
    await speakText(clean)
    return
  }
  speakWs.send(JSON.stringify({ type: 'text.delta', delta: clean + ' ' }))
  if (done) speakWs.send(JSON.stringify({ type: 'text.done' }))
}

export function finishSpeakStream() {
  if (speakWs && speakWs.readyState === WebSocket.OPEN) {
    try { speakWs.send(JSON.stringify({ type: 'text.done' })) } catch { /* noop */ }
  }
}

export const SPEAK_IDLE_TIMEOUT_MS = 12_000

export function waitSpeakIdle(timeoutMs = SPEAK_IDLE_TIMEOUT_MS) {
  let timedOut = false
  return Promise.race([
    speakQueue.then(() => undefined),
    new Promise((resolve) => {
      window.setTimeout(() => {
        timedOut = true
        resolve()
      }, timeoutMs)
    }),
  ]).then(() => {
    if (timedOut) speakText.stop?.()
  })
}

export function normalizeUtterance(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** message_user leftover when auto-reply already delivered the real sentence. */
export function isTalkAckText(text) {
  return /^(replied|done|sent|ok|noted|pong sent)[.!]?$/i.test(String(text || '').replace(/\s+/g, ' ').trim())
}

/** xAI keyterm boost dumps, not something the caller said. */
export function isGhostTranscript(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return true
  return /^keyterms?\s*:/i.test(t)
}

/** TTS leaking back into STT (Hive/Pulse/etc. after we just spoke). */
export function isEchoUtterance(heard, lastSpoken, now, spokenAt, windowMs = 4000) {
  const a = normalizeUtterance(heard)
  const b = normalizeUtterance(lastSpoken)
  if (!a || !b) return false
  if (now - spokenAt > windowMs) return false
  if (a === b || b.includes(a) || (a.length >= 8 && a.includes(b))) return true
  return /^(shizuha|hritik|hive|cortex|pulse)[.!?]?$/.test(a)
}

export function isDuplicateUtterance(next, prev, now, prevAt, windowMs = 2500) {
  const a = normalizeUtterance(next)
  const b = normalizeUtterance(prev)
  if (!a || !b || a !== b) return false
  return now - prevAt < windowMs
}

export function spokenCovers(full, spoken) {
  const a = String(full || '').replace(/\s+/g, ' ').trim()
  const b = String(spoken || '').replace(/\s+/g, ' ').trim()
  return !!b && a.startsWith(b)
}

export function nextSpokenSentences(buffer, alreadySpoken, { flushRemainder = false } = {}) {
  const out = []
  let rest = String(buffer || '')
  const spoken = alreadySpoken || ''
  if (spoken && rest.startsWith(spoken)) rest = rest.slice(spoken.length)
  const re = /[\s\S]*?[.!?…](?:["')\]]+)?(?=\s|$)/g
  let m
  let consumed = spoken
  let used = 0
  while ((m = re.exec(rest)) !== null) {
    const sentence = m[0].trim()
    // Talk-seat replies are often one short word ("pong."). Waiting for 8
    // chars left those on the persist+unary path (~1.5s extra).
    if (sentence.length >= 2) {
      out.push(sentence)
      consumed += m[0]
      used = m.index + m[0].length
    }
  }
  if (flushRemainder) {
    const leftover = rest.slice(used).trim()
    if (leftover) {
      out.push(leftover)
      consumed += rest.slice(used)
    }
  }
  return { sentences: out, spoken: consumed }
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
  const lastUtteranceRef = useRef({ text: '', at: 0 })
  const lastSpokenRef = useRef({ text: '', at: 0 })

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
        onPartial: (text) => {
          if (!activeRef.current || mutedRef.current) return
          const heard = String(text || '').trim()
          if (heard) setLastHeard(heard)
        },
        onFinal: (text) => {
          streamingRef.current = null
          if (!activeRef.current || mutedRef.current || !text.trim()) return
          const heard = text.trim()
          const now = Date.now()
          if (isGhostTranscript(heard) || isTalkAckText(heard)) {
            utteranceDelivered = true
            return
          }
          if (isEchoUtterance(heard, lastSpokenRef.current.text, now, lastSpokenRef.current.at)) {
            utteranceDelivered = true
            return
          }
          if (isDuplicateUtterance(heard, lastUtteranceRef.current.text, now, lastUtteranceRef.current.at)) {
            utteranceDelivered = true
            return
          }
          lastUtteranceRef.current = { text: heard, at: now }
          utteranceDelivered = true
          streamAttemptsRef.current = 0
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

  // Speak a reply, then re-listen. Mic stays DOWN while TTS plays: HTML Audio
  // is not in the WebRTC graph, so browser AEC cannot cancel it. Leaving the
  // mic open doubled Ena's voice and re-finalized the same user utterance
  // across overlapping STT sessions.
  const resumeListen = useCallback(() => {
    if (!activeRef.current || mutedRef.current || speakingRef.current) return
    if (!streamingRef.current) listenOnceRef.current?.()
  }, [])

  const beginSpeak = useCallback((text) => {
    if (!activeRef.current) return
    speakingRef.current = true
    setCallState('speaking')
    teardownCapture()
    const clean = String(text || '').trim()
    if (clean) lastSpokenRef.current = { text: clean, at: Date.now() }
  }, [teardownCapture])

  const endSpeak = useCallback(async () => {
    finishSpeakStream()
    await waitSpeakIdle()
    speakingRef.current = false
    if (!activeRef.current) return
    if (mutedRef.current) {
      setCallState('listening')
      return
    }
    setCallState('listening')
    resumeListen()
  }, [resumeListen])

  const notifyReply = useCallback(async (text) => {
    if (!activeRef.current || !text) return
    beginSpeak(text)
    await speakDelta(text)
    await endSpeak()
  }, [beginSpeak, endSpeak])

  const startCall = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    mutedRef.current = false
    speakingRef.current = false
    streamAttemptsRef.current = 0
    lastUtteranceRef.current = { text: '', at: 0 }
    lastSpokenRef.current = { text: '', at: 0 }
    setMuted(false)
    setLastHeard('')
    setCallError(null)
    void startSpeakStream()
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
    lastUtteranceRef.current = { text: '', at: 0 }
    lastSpokenRef.current = { text: '', at: 0 }
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
    beginSpeak,
    endSpeak,
    resumeListen,
    isCallActive: () => activeRef.current,
  }
}
