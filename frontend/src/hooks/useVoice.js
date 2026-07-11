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

/** Speak `text` aloud — self-hosted TTS when available, speechSynthesis otherwise. */
export async function speakText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
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
        currentAudio = new Audio(url)
        currentAudio.onended = () => { URL.revokeObjectURL(url); currentAudio = null }
        await currentAudio.play()
        return
      }
    }
  } catch { /* fall through to browser voice */ }
  if (typeof speechSynthesis !== 'undefined') {
    const utter = new SpeechSynthesisUtterance(clean)
    utter.rate = 1.05
    speechSynthesis.speak(utter)
  }
}

speakText.stop = () => {
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    currentAudio = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
