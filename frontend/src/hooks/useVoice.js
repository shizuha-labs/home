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

export function useVoiceConversation({ onUtterance } = {}) {
  const [callState, setCallState] = useState('idle') // idle | listening | thinking | speaking
  const activeRef = useRef(false)
  const streamingRef = useRef(null)
  const onUtteranceRef = useRef(onUtterance)
  onUtteranceRef.current = onUtterance
  const listenOnceRef = useRef(null)

  const teardownCapture = useCallback(() => {
    streamingRef.current?.cancel()
    streamingRef.current = null
  }, [])

  const listenOnce = useCallback(() => {
    if (!activeRef.current) return
    setCallState('listening')
    let utteranceDelivered = false
    try {
      const controller = startStreamingStt({
        token: getAccessToken(),
        onPartial: () => {},
        onFinal: (text) => {
          streamingRef.current = null
          if (!activeRef.current || !text.trim()) return
          utteranceDelivered = true
          setCallState('thinking')
          onUtteranceRef.current?.(text.trim())
        },
        onDone: () => {
          if (activeRef.current && !utteranceDelivered) {
            window.setTimeout(() => listenOnceRef.current?.(), 250)
          }
        },
        onError: () => {
          streamingRef.current = null
          if (activeRef.current) window.setTimeout(() => listenOnceRef.current?.(), 400)
        },
      })
      streamingRef.current = controller
    } catch {
      activeRef.current = false
      setCallState('idle')
    }
  }, [])
  listenOnceRef.current = listenOnce

  // Parent calls this when Shizuha's reply text arrives → speak, then re-listen.
  const notifyReply = useCallback(async (text) => {
    if (!activeRef.current || !text) return
    setCallState('speaking')
    await speakText(text)
    if (activeRef.current) listenOnceRef.current?.()
  }, [])

  const startCall = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    listenOnceRef.current?.()
  }, [])

  const endCall = useCallback(() => {
    activeRef.current = false
    teardownCapture()
    speakText.stop()
    setCallState('idle')
  }, [teardownCapture])

  useEffect(() => () => { activeRef.current = false; teardownCapture(); speakText.stop() }, [teardownCapture])

  return { callState, startCall, endCall, notifyReply, isCallActive: () => activeRef.current }
}
