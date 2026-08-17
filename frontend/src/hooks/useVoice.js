import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'
import { beginLiveCall, emitLiveTrace, endLiveCall, voiceCorrelation } from '../utils/liveTrace'
import { shouldCommitOnMute, startStreamingStt } from '../utils/streamingStt'

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
let speakEpoch = 0
let speakMuted = false
let speakGain = null

export function isSpeakOutputMuted() {
  return speakMuted
}

if (typeof window !== 'undefined') {
  window.__shizuhaSpeakOutput = () => ({
    muted: speakMuted,
    remainingMs: remainingSpeakMs(),
    epoch: speakEpoch,
  })
}

export function getSpeakEpoch() {
  return speakEpoch
}

function muteSpeakOutput() {
  speakMuted = true
  if (speakGain && gaplessCtx && typeof gaplessCtx.currentTime === 'number') {
    const now = gaplessCtx.currentTime
    try { speakGain.gain.cancelScheduledValues(now) } catch { /* noop */ }
    try { speakGain.gain.setValueAtTime(0, now) } catch { speakGain.gain.value = 0 }
  } else if (speakGain) {
    speakGain.gain.value = 0
  }
  if (gaplessCtx && gaplessCtx.state === 'running') {
    try { void gaplessCtx.suspend() } catch { /* noop */ }
  }
}

export function unmuteSpeakOutput() {
  speakMuted = false
  if (gaplessCtx && gaplessCtx.state === 'suspended') {
    try { void gaplessCtx.resume() } catch { /* noop */ }
  }
  if (speakGain && gaplessCtx && typeof gaplessCtx.currentTime === 'number') {
    const now = gaplessCtx.currentTime
    try { speakGain.gain.cancelScheduledValues(now) } catch { /* noop */ }
    try { speakGain.gain.setValueAtTime(1, now) } catch { speakGain.gain.value = 1 }
  } else if (speakGain) {
    speakGain.gain.value = 1
  }
}

/** Stop in-flight audio without latching mute. Barge-in must not kill the next play. */
export function interruptSpeakOutput() {
  speakEpoch += 1
  stopGaplessPlayback()
  stopSpeakStream()
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    currentAudio = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  speakQueue = Promise.resolve()
  unmuteSpeakOutput()
}

/** Speak `text` aloud — self-hosted TTS when available, speechSynthesis
 * otherwise. Returns a promise that resolves when playback FINISHES (so a
 * voice-conversation loop can resume listening after the reply is spoken). */
export async function speakText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500)
  if (!clean) return
  speakText.stop()
  const epoch = speakEpoch
  unmuteSpeakOutput()
  try {
    const serverReady = await probeVoiceService()
    if (epoch !== speakEpoch) return
    if (serverReady) {
      const res = await fetch('/voice/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ text: clean, speed: readTtsSpeed() }),
      })
      if (res.ok) {
        const blob = await res.blob()
        if (epoch !== speakEpoch || speakMuted) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.playbackRate = readTtsSpeed()
        currentAudio = audio
        await new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
          audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
          if (epoch !== speakEpoch || speakMuted) {
            URL.revokeObjectURL(url)
            if (currentAudio === audio) currentAudio = null
            resolve()
            return
          }
          audio.play().catch(() => resolve())
        })
        return
      }
    }
  } catch { /* fall through to browser voice */ }
  if (epoch !== speakEpoch) return
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
  const remaining = remainingSpeakMs()
  speakEpoch += 1
  muteSpeakOutput()
  emitLiveTrace('tts.stop', { remaining_ms: remaining, epoch: speakEpoch })
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    try { currentAudio.volume = 0 } catch { /* noop */ }
    try { currentAudio.src = '' } catch { /* noop */ }
    currentAudio = null
  }
  stopGaplessPlayback()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  stopSpeakStream()
  speakQueue = Promise.resolve()
}

// ── Talk speed (Grok TTS 0.7–1.5). Default 1.2 so Live does not linger. ──
export const TTS_SPEED_KEY = 'shizuha_tts_speed'
export const TTS_SPEED_PRESETS = [1, 1.2, 1.4]

export function clampTtsSpeed(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1.2
  return Math.min(1.5, Math.max(0.7, Math.round(n * 10) / 10))
}

export function readTtsSpeed() {
  try {
    return clampTtsSpeed(localStorage.getItem(TTS_SPEED_KEY) ?? 1.2)
  } catch {
    return 1.2
  }
}

export function nextTtsSpeed(current = readTtsSpeed()) {
  const cur = clampTtsSpeed(current)
  const i = TTS_SPEED_PRESETS.findIndex((p) => p > cur + 0.01)
  return i === -1 ? TTS_SPEED_PRESETS[0] : TTS_SPEED_PRESETS[i]
}

export function writeTtsSpeed(value) {
  const next = clampTtsSpeed(value)
  try { localStorage.setItem(TTS_SPEED_KEY, String(next)) } catch { /* private */ }
  if (speakWs && speakWs.readyState === WebSocket.OPEN) {
    stopSpeakStream()
    startSpeakStream()
  }
  return next
}

export function cycleTtsSpeed() {
  return writeTtsSpeed(nextTtsSpeed())
}

export function formatTtsSpeed(value = readTtsSpeed()) {
  const n = clampTtsSpeed(value)
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}×`
}

// ── Streaming TTS (Grok WS via /voice/api/tts/stream, Kokoro backup) ────────
let speakWs = null
let speakReady = null
let speakQueue = Promise.resolve()
let ttsDeltaCount = 0
let ttsDeltaChars = 0
let streamingTtsAvailable = null // null = unprobed
let speakProvider = 'grok'
let gaplessCtx = null
let gaplessHead = 0
const gaplessSources = []
let pcmRemainder = new Uint8Array(0)
let fadeNextPcm = true
let releasedUntil = 0
const PCM_SAMPLE_RATE = 24000
/** Room + AEC settle after the playhead ends before the mic opens again. */
export const SPEAK_RELEASE_MS = 800
/** First Live flush waits for a real phrase so Grok does not synth a lone "Hey." */
export const FIRST_SPEAK_MIN_CHARS = 24

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

function stopGaplessPlayback() {
  for (const src of gaplessSources) {
    try { src.stop() } catch { /* already stopped */ }
    try { src.disconnect() } catch { /* already disconnected */ }
  }
  gaplessSources.length = 0
  if (gaplessCtx && typeof gaplessCtx.currentTime === 'number') {
    gaplessHead = gaplessCtx.currentTime
  } else {
    gaplessHead = 0
  }
  pcmRemainder = new Uint8Array(0)
  fadeNextPcm = true
  releasedUntil = 0
}

function isPcmMime(mime) {
  const t = String(mime || '').toLowerCase()
  return t.includes('pcm') || t.includes('l16') || t.includes('raw')
}

let keepAliveOsc = null

function ensureKeepAlive(ctx) {
  if (!ctx || keepAliveOsc) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.00001
    osc.frequency.value = 20
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    keepAliveOsc = osc
  } catch { /* optional */ }
}

function ensureGaplessCtx() {
  const Ctx = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (typeof window !== 'undefined' ? window.webkitAudioContext : null)
  if (!Ctx) return null
  if (!gaplessCtx) {
    gaplessCtx = new Ctx({ sampleRate: PCM_SAMPLE_RATE })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') unmuteSpeakOutput()
      })
    }
  }
  if (!speakMuted && gaplessCtx.state === 'suspended') void gaplessCtx.resume()
  ensureKeepAlive(gaplessCtx)
  return gaplessCtx
}

/** Must run in the Live-click turn so Safari/Chrome do not start TTS suspended. */
export function warmSpeakOutput() {
  unmuteSpeakOutput()
  const ctx = ensureGaplessCtx()
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function pcmBytesWithoutWavHeader(bytes) {
  if (
    bytes.length < 12
    || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46
    || bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) return bytes
  let i = 12
  while (i + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    const size = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)
    if (id === 'data') return bytes.subarray(i + 8, Math.min(bytes.length, i + 8 + Math.max(0, size)))
    i += 8 + Math.max(0, size)
  }
  return bytes
}

function fadeInChannel(channel, sampleRate) {
  const n = Math.min(channel.length, Math.round((sampleRate || PCM_SAMPLE_RATE) * 0.02))
  if (n <= 1) return
  for (let i = 0; i < n; i += 1) channel[i] *= i / n
}

function ensureSpeakGain() {
  const ctx = ensureGaplessCtx()
  if (!ctx) return null
  if (!speakGain || speakGain.context !== ctx) {
    speakGain = ctx.createGain()
    speakGain.gain.value = speakMuted ? 0 : 1
    speakGain.connect(ctx.destination)
  }
  return speakGain
}

function scheduleAudioBuffer(buf, rate, epoch = speakEpoch) {
  if (speakMuted || epoch !== speakEpoch) return Promise.resolve()
  const ctx = gaplessCtx
  if (!ctx) return Promise.resolve()
  const gain = ensureSpeakGain()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  src.connect(gain || ctx.destination)
  const now = ctx.currentTime
  if (gaplessHead < now + 0.005) gaplessHead = now + 0.005
  src.start(gaplessHead)
  const dur = buf.duration / (rate || 1)
  gaplessHead += dur
  releasedUntil = Date.now() + Math.ceil(dur * 1000) + SPEAK_RELEASE_MS
  gaplessSources.push(src)
  return new Promise((resolve) => {
    src.onended = () => {
      const i = gaplessSources.indexOf(src)
      if (i >= 0) gaplessSources.splice(i, 1)
      resolve()
    }
  })
}

export function playPcmChunk(bytes, sampleRate = PCM_SAMPLE_RATE, rate = 1, { fade = true } = {}) {
  const epoch = speakEpoch
  if (speakMuted) return Promise.resolve()
  const ctx = ensureGaplessCtx()
  if (!ctx) return playHtmlAudioChunk(bytes, 'audio/wav', rate)
  if (speakMuted || epoch !== speakEpoch) return Promise.resolve()
  const merged = new Uint8Array(pcmRemainder.length + bytes.length)
  merged.set(pcmRemainder, 0)
  merged.set(bytes, pcmRemainder.length)
  const even = merged.byteLength - (merged.byteLength % 2)
  pcmRemainder = even < merged.byteLength ? merged.slice(even) : new Uint8Array(0)
  if (even < 2) return Promise.resolve()
  const evenBytes = pcmBytesWithoutWavHeader(merged.subarray(0, even))
  const evenLen = evenBytes.byteLength - (evenBytes.byteLength % 2)
  if (evenLen < 2) return Promise.resolve()
  const samples = new Int16Array(evenBytes.buffer, evenBytes.byteOffset, evenLen / 2)
  const buf = ctx.createBuffer(1, samples.length, sampleRate)
  const channel = buf.getChannelData(0)
  for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768
  if (fade && fadeNextPcm) {
    fadeInChannel(channel, sampleRate)
    fadeNextPcm = false
  } else {
    fadeNextPcm = false
  }
  return scheduleAudioBuffer(buf, rate, epoch)
}

function playHtmlAudioChunk(bytes, mime, rate) {
  const epoch = speakEpoch
  if (speakMuted || epoch !== speakEpoch) return Promise.resolve()
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.playbackRate = rate
  currentAudio = audio
  return new Promise((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
    audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve() }
    if (speakMuted || epoch !== speakEpoch) {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      resolve()
      return
    }
    audio.play().catch(() => resolve())
  })
}

export function playAudioChunk(b64, mime = 'audio/mpeg', sampleRate = PCM_SAMPLE_RATE) {
  const epoch = speakEpoch
  if (speakMuted || !b64) return Promise.resolve()
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  // Grok already synthesized at the requested speed. Kokoro/HTML fallback
  // needs a client playbackRate so Fast still shortens talk time.
  const rate = speakProvider === 'grok' ? 1 : readTtsSpeed()
  if (isPcmMime(mime)) return playPcmChunk(bytes, sampleRate || PCM_SAMPLE_RATE, rate)
  const ctx = ensureGaplessCtx()
  if (!ctx) return playHtmlAudioChunk(bytes, mime, rate)
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return ctx.decodeAudioData(copy).then((buf) => {
      if (epoch !== speakEpoch || speakMuted) return undefined
      return scheduleAudioBuffer(buf, rate, epoch)
    }).catch(() => {
      if (epoch !== speakEpoch || speakMuted) return undefined
      return playHtmlAudioChunk(bytes, mime, rate)
    })
  } catch {
    return playHtmlAudioChunk(bytes, mime, rate)
  }
}

function stopSpeakStream() {
  if (ttsDeltaCount) {
    emitLiveTrace('tts.audio.stop', { deltas: ttsDeltaCount, b64_chars: ttsDeltaChars })
  }
  ttsDeltaCount = 0
  ttsDeltaChars = 0
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
        emitLiveTrace('tts.stream.open', { voice: voice || 'ara', speed: readTtsSpeed() })
        ws.send(JSON.stringify({
          type: 'start',
          token: getAccessToken(),
          voice: voice || 'ara',
          language: 'en',
          speed: readTtsSpeed(),
          ...voiceCorrelation(),
        }))
      }
      ws.onmessage = (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'ready') {
          speakProvider = msg.provider || 'grok'
          emitLiveTrace('tts.stream.ready', { provider: speakProvider })
          clearTimeout(timer)
          resolve(true)
        } else if (msg.type === 'audio.delta' && msg.delta) {
          if (speakWs !== ws || speakMuted) return
          ttsDeltaCount += 1
          ttsDeltaChars += String(msg.delta).length
          if (ttsDeltaCount === 1) emitLiveTrace('tts.audio.start', { mime: msg.mime || '', provider: speakProvider })
          // PCM chunks are raw samples — schedule on one playhead. Independent
          // MP3 decode of each delta is what sounded like a cut syllable.
          const played = playAudioChunk(
            msg.delta,
            msg.mime || (speakProvider === 'grok' ? 'audio/pcm' : 'audio/mpeg'),
            msg.sample_rate || PCM_SAMPLE_RATE,
          )
          speakQueue = speakQueue.then(() => played)
        } else if (msg.type === 'audio.clear') {
          stopGaplessPlayback()
          speakQueue = Promise.resolve()
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
  const epoch = speakEpoch
  const ready = await startSpeakStream()
  if (epoch !== speakEpoch) return
  unmuteSpeakOutput()
  if (!ready || !speakWs || speakWs.readyState !== WebSocket.OPEN) {
    await speakText(clean)
    return
  }
  speakWs.send(JSON.stringify({ type: 'text.delta', delta: clean + ' ' }))
  if (done) speakWs.send(JSON.stringify({ type: 'text.done' }))
}

export function resetSpeakOutputForTests() {
  speakEpoch += 1
  speakMuted = false
  stopGaplessPlayback()
  stopSpeakStream()
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    currentAudio = null
  }
  gaplessCtx = null
  speakGain = null
  keepAliveOsc = null
  speakQueue = Promise.resolve()
}

export function finishSpeakStream() {
  if (speakWs && speakWs.readyState === WebSocket.OPEN) {
    try { speakWs.send(JSON.stringify({ type: 'text.done' })) } catch { /* noop */ }
  }
}

export const SPEAK_IDLE_TIMEOUT_MS = 90_000

export function remainingSpeakMs() {
  if (speakMuted) return 0
  const releaseMs = Math.max(0, releasedUntil - Date.now())
  let playMs = 0
  if (gaplessCtx && typeof gaplessCtx.currentTime === 'number' && gaplessHead > gaplessCtx.currentTime) {
    playMs = Math.ceil((gaplessHead - gaplessCtx.currentTime) * 1000)
  }
  return Math.max(playMs, releaseMs)
}

export function waitSpeakIdle(timeoutMs = SPEAK_IDLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  return Promise.race([
    speakQueue.catch(() => undefined),
    new Promise((resolve) => { window.setTimeout(resolve, timeoutMs) }),
  ]).then(async () => {
    while (remainingSpeakMs() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => { window.setTimeout(resolve, 80) })
    }
  })
}

export function normalizeUtterance(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** message_user leftover when auto-reply already delivered the real sentence. */
export function isTalkAckText(text) {
  return /^(replied|done|sent|ok|noted|pong sent)[.!]?$/i.test(String(text || '').replace(/\s+/g, ' ').trim())
}

/** STT-only fillers. Not isTalkAckText — that hides rows in the thread. */
const LIVE_FILLER = new Set([
  'good', 'okay', 'ok', 'k', 'yeah', 'yup', 'yep', 'nah', 'here',
  'alright', 'cool', 'sure', 'thanks', 'thank', 'fine', 'huh', 'uh',
  'um', 'hmm', 'mm', 'mhm', 'oh', 'ah', 'right', 'nice', 'great',
  'gotcha', 'copy', 'roger', 'i', 'im', "i'm",
])

export function isLiveFillerUtterance(text) {
  const words = normalizeUtterance(text)
    .replace(/[.!?,;:'"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return true
  return words.every((w) => LIVE_FILLER.has(w))
}

const STT_KEYTERM_ONLY = /^(shizuha|hritik|hive|cortex|pulse|ena|yuna)[.!?]?$/i

/** xAI keyterm boost dumps, not something the caller said. */
export function isGhostTranscript(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (/^keyterms?\s*:/i.test(t)) return true
  return STT_KEYTERM_ONLY.test(t)
}

/** Common STT confusions for talk-seat names. */
export function normalizeHeardName(text) {
  return String(text || '').replace(/\bNawa\b/g, 'Ena').replace(/\bNawah\b/g, 'Ena')
}

const ECHO_STOP = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'just', 'so', 'you', 'your'])

function echoTokens(text) {
  return normalizeUtterance(text)
    .replace(/[.!?,;:'"]/g, '')
    .split(/\s+/)
    .map((w) => (w === "i'm" || w === 'im' ? 'i' : w))
    .filter((w) => w && !ECHO_STOP.has(w))
}

export function echoTokenOverlap(heard, lastSpoken) {
  const a = new Set(echoTokens(heard))
  const b = new Set(echoTokens(lastSpoken))
  if (!a.size || !b.size) return 0
  let n = 0
  for (const w of a) if (b.has(w)) n += 1
  return n / Math.min(a.size, b.size)
}

/** TTS leaking back into STT (Hive/Pulse/etc. after we just spoke). */
export function isEchoUtterance(heard, lastSpoken, now, spokenAt, windowMs = 12000) {
  const a = normalizeUtterance(heard)
  const b = normalizeUtterance(lastSpoken)
  if (!a || !b) return false
  if (STT_KEYTERM_ONLY.test(a)) return true
  if (now - spokenAt > windowMs) return false
  if (a === b || b.includes(a) || (a.length >= 8 && a.includes(b))) return true
  return echoTokenOverlap(a, b) >= 0.45
}

export function readyToFlushSpokenSentences(alreadySpoken, joined, ended) {
  if (alreadySpoken) return true
  if (ended) return true
  return String(joined || '').replace(/\s+/g, ' ').trim().length >= FIRST_SPEAK_MIN_CHARS
}

/** One gate for HUD caption, compose echo, and send — same class as mute/echo drops. */
export function shouldSurfaceHeard(heard, {
  muted = false,
  lastSpoken = '',
  spokenAt = 0,
  now = Date.now(),
} = {}) {
  const text = normalizeHeardName(String(heard || '').trim())
  if (!text) return { ok: false, reason: 'empty', text: '' }
  if (isGhostTranscript(text) || isTalkAckText(text)) return { ok: false, reason: 'ghost', text }
  if (isLiveFillerUtterance(text)) return { ok: false, reason: 'filler', text }
  if (muted && !shouldCommitOnMute(text)) return { ok: false, reason: 'muted_fragment', text }
  if (isEchoUtterance(text, lastSpoken, now, spokenAt)) return { ok: false, reason: 'echo', text }
  return { ok: true, reason: '', text }
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
    emitLiveTrace('call.error', { kind, message, can_retry: canRetry ? 1 : 0 })
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

  const listenOnce = useCallback((opts = {}) => {
    if (!activeRef.current || mutedRef.current) return
    const seed = String(opts.seed || '').trim()
    const holdCount = Number(opts.holdCount) || 0
    clearTimers()
    setCallError(null)
    if (!speakingRef.current) setCallState('connecting')
    let utteranceDelivered = false
    try {
      const controller = startStreamingStt({
        token: getAccessToken(),
        ...voiceCorrelation(),
        seed,
        holdCount,
        onState: (state) => {
          if (!activeRef.current) return
          // Promote connecting → listening once the stream is live. Ignore
          // 'idle'/'transcribing' here — conversation owns those transitions.
          if (state === 'listening') {
            // A live listen means the stream path worked; reset the failure budget.
            streamAttemptsRef.current = 0
            if (!speakingRef.current) setCallState('listening')
          } else if (state === 'connecting' && !speakingRef.current && !mutedRef.current) {
            setCallState('connecting')
          }
        },
        onPartial: (text) => {
          if (!activeRef.current) return
          const surface = shouldSurfaceHeard(text, {
            muted: mutedRef.current,
            lastSpoken: lastSpokenRef.current.text,
            spokenAt: lastSpokenRef.current.at,
          })
          if (!surface.ok) {
            if (surface.reason === 'echo' || surface.reason === 'muted_fragment' || surface.reason === 'filler') {
              setLastHeard('')
            }
            return
          }
          setLastHeard(surface.text)
        },
        onFinal: (text) => {
          streamingRef.current = null
          if (!activeRef.current || !text.trim()) return
          const now = Date.now()
          const surface = shouldSurfaceHeard(text, {
            muted: mutedRef.current,
            lastSpoken: lastSpokenRef.current.text,
            spokenAt: lastSpokenRef.current.at,
            now,
          })
          if (!surface.ok) {
            if (surface.reason === 'muted_fragment') emitLiveTrace('stt.muted_drop', { text: surface.text })
            if (surface.reason === 'echo') emitLiveTrace('stt.echo_drop', { text: surface.text })
            if (surface.reason === 'filler') emitLiveTrace('stt.filler_drop', { text: surface.text })
            if (surface.reason === 'echo' || surface.reason === 'muted_fragment' || surface.reason === 'ghost' || surface.reason === 'filler') {
              setLastHeard('')
            }
            utteranceDelivered = true
            return
          }
          const heard = surface.text
          if (isDuplicateUtterance(heard, lastUtteranceRef.current.text, now, lastUtteranceRef.current.at)) {
            utteranceDelivered = true
            return
          }
          lastUtteranceRef.current = { text: heard, at: now }
          utteranceDelivered = true
          streamAttemptsRef.current = 0
          emitLiveTrace('stt.final', { text: heard })
          setLastHeard(heard)
          if (speakingRef.current) {
            speakingRef.current = false
            speakText.stop()
          }
          setCallState('thinking')
          onUtteranceRef.current?.(heard)
        },
        onDone: (event) => {
          streamingRef.current = null
          // Grok ended the session mid-thought: reopen with the leftover
          // seed so "login there" and the rest stay one turn.
          if (activeRef.current && !utteranceDelivered && !mutedRef.current) {
            const holdSeed = event?.hold ? String(event.text || seed || '') : ''
            if (holdSeed) emitLiveTrace('stt.hold', { text: holdSeed.slice(0, 160), hold: event.holdCount || 1 })
            if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null
              if (activeRef.current && !mutedRef.current) {
                listenOnceRef.current?.(holdSeed
                  ? { seed: holdSeed, holdCount: event.holdCount || 1 }
                  : {})
              }
            }, holdSeed ? 80 : 250)
          }
        },
        onError: (error) => {
          streamingRef.current = null
          // startStreamingStt already disposed WS/AudioContext/mic tracks.
          if (!activeRef.current) return
          const message = String(error?.message || '')
          if (/time.?limit|idle_timeout|session reached/i.test(message)) {
            listenOnceRef.current?.()
            return
          }
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
    emitLiveTrace('tts.speak.begin', { text })
    teardownCapture()
    const clean = String(text || '').trim()
    if (clean) {
      const prev = lastSpokenRef.current
      const joined = prev.text && (Date.now() - prev.at) < 30_000
        ? `${prev.text} ${clean}`
        : clean
      lastSpokenRef.current = { text: joined.slice(-400), at: Date.now() }
    }
  }, [teardownCapture])

  const endSpeak = useCallback(async () => {
    finishSpeakStream()
    await waitSpeakIdle()
    speakingRef.current = false
    if (lastSpokenRef.current.text) {
      lastSpokenRef.current = { ...lastSpokenRef.current, at: Date.now() }
    }
    if (!activeRef.current) return
    if (mutedRef.current) {
      setCallState('listening')
      return
    }
    setCallState('listening')
    resumeListen()
  }, [resumeListen])

  // Voice replies off / barge-in: cut audio now. Do not wait for leftover
  // TTS the way endSpeak does — that is how she kept talking after Off.
  const cancelSpeak = useCallback(() => {
    emitLiveTrace('tts.cancel', { remaining_ms: remainingSpeakMs() })
    speakText.stop()
    speakingRef.current = false
    if (!activeRef.current) return
    setCallState('listening')
    if (!mutedRef.current) resumeListen()
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
    beginLiveCall()
    emitLiveTrace('call.start', {})
    setMuted(false)
    setLastHeard('')
    setCallError(null)
    warmSpeakOutput()
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
    endLiveCall()
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
    emitLiveTrace(next ? 'mic.mute' : 'mic.unmute', {})
    if (next) {
      // Phone mute: stop new audio. Commit a finished sentence. Drop "I'm".
      streamingRef.current?.setMicEnabled?.(false)
      const pending = streamingRef.current?.pendingText?.() || ''
      if (shouldCommitOnMute(pending)) streamingRef.current?.hintTurnComplete?.()
      else streamingRef.current?.discardPending?.()
    } else if (streamingRef.current) {
      streamingRef.current.setMicEnabled?.(true)
    } else if (!speakingRef.current) {
      listenOnceRef.current?.()
    }
  }, [])

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
    cancelSpeak,
    resumeListen,
    isCallActive: () => activeRef.current,
  }
}
