import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'

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
  const [micState, setMicState] = useState('idle') // idle | listening | transcribing
  const recognitionRef = useRef(null)
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
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      try { mr.stop() } catch { /* already stopped */ }
    }
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

  const toggleMic = useCallback(async () => {
    if (micState === 'listening') { stopAll(); return }
    if (micState === 'transcribing') return
    try {
      const serverReady = await probeVoiceService()
      if (serverReady && navigator.mediaDevices?.getUserMedia) {
        await startServerRecording()
      } else if (SpeechRecognitionImpl) {
        startBrowserRecognition()
      }
    } catch {
      // Mic permission denied or recognition unavailable.
      setMicState('idle')
    }
  }, [micState, startBrowserRecognition, startServerRecording, stopAll])

  useEffect(() => () => stopAll(), [stopAll])

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

async function _transcribeBlob(blob) {
  const serverReady = await probeVoiceService()
  if (!serverReady) return ''
  try {
    const form = new FormData()
    form.append('audio', blob, 'utt.webm')
    const res = await fetch('/voice/api/stt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      body: form,
    })
    if (res.ok) return (await res.json()).text || ''
  } catch { /* ignore */ }
  return ''
}

export function useVoiceConversation({ onUtterance } = {}) {
  const [callState, setCallState] = useState('idle') // idle | listening | thinking | speaking
  const activeRef = useRef(false)
  const mrRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const vadRafRef = useRef(null)
  const chunksRef = useRef([])
  const onUtteranceRef = useRef(onUtterance)
  onUtteranceRef.current = onUtterance
  const listenOnceRef = useRef(null)

  const teardownCapture = useCallback(() => {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null }
    const mr = mrRef.current
    if (mr && mr.state !== 'inactive') { try { mr.stop() } catch { /* noop */ } }
    mrRef.current = null
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null }
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch { /* noop */ } audioCtxRef.current = null }
  }, [])

  const listenOnce = useCallback(async () => {
    if (!activeRef.current) return
    setCallState('listening')
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      activeRef.current = false
      setCallState('idle')
      return
    }
    streamRef.current = stream
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const mr = new MediaRecorder(stream, { mimeType: mime })
    mrRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      teardownCapture()
      const blob = new Blob(chunksRef.current, { type: mime })
      chunksRef.current = []
      if (!activeRef.current) return
      if (blob.size < 2500) { listenOnceRef.current?.(); return } // too short — re-listen
      setCallState('thinking')
      const text = await _transcribeBlob(blob)
      if (!activeRef.current) return
      if (text && text.trim()) {
        onUtteranceRef.current?.(text.trim())  // parent sends; reply arrives via notifyReply
      } else {
        listenOnceRef.current?.() // heard nothing usable — listen again
      }
    }
    mr.start()

    // VAD: watch RMS; stop the recorder ~1.1s after speech ends. Also a hard
    // 15s cap, and an 8s no-speech timeout to re-listen (avoids a stuck mic).
    let ctx
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const startedAt = performance.now()
      let spokeAt = 0
      let lastLoud = 0
      const SPEECH = 0.018   // RMS threshold for "speaking"
      const HANG_MS = 1100   // silence after speech → end utterance
      const MAX_MS = 15000
      const NOSPEECH_MS = 8000
      const tick = () => {
        if (!activeRef.current || mr.state !== 'recording') return
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        const now = performance.now()
        if (rms > SPEECH) { if (!spokeAt) spokeAt = now; lastLoud = now }
        const elapsed = now - startedAt
        const endedBySilence = spokeAt && (now - lastLoud > HANG_MS)
        const noSpeech = !spokeAt && elapsed > NOSPEECH_MS
        if (endedBySilence || elapsed > MAX_MS || noSpeech) {
          if (noSpeech) { // nothing said — stop and re-listen without a round-trip
            try { mr.stop() } catch { /* noop */ }
            return
          }
          try { mr.stop() } catch { /* noop */ }
          return
        }
        vadRafRef.current = requestAnimationFrame(tick)
      }
      vadRafRef.current = requestAnimationFrame(tick)
    } catch { /* no Web Audio — recorder still stops via endCall/max via onstop path */ }
  }, [teardownCapture])
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
