import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'
import { beginLiveCall, emitLiveTrace, endLiveCall, voiceCorrelation } from '../utils/liveTrace'
import { historyToVoiceItems, realtimeVoiceUrl, shouldHoldMicWhileSpeaking } from '../utils/grokVoice'
import {
  classifyVoiceError,
  playPcmChunk,
  speakText,
  shouldSurfaceHeard,
  unmuteSpeakOutput,
  interruptSpeakOutput,
  isSpeakOutputMuted,
  warmSpeakOutput,
  remainingSpeakMs,
  SPEAK_RELEASE_MS,
  VOICE_STREAM_BASE_BACKOFF_MS,
} from './useVoice'

const MIC_ERROR_MESSAGES = {
  no_mic: 'No microphone found. Connect a mic or type instead.',
  permission_denied: 'Microphone permission denied. Allow mic access in your browser settings, then try again.',
}

function toPcm16(samples) {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return pcm.buffer
}

const PREROLL_SAMPLES = 24000 * 0.08

function concatPcm(chunks) {
  const total = chunks.reduce((n, chunk) => n + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  })
  return merged
}

function playS2SPcm(bytes, onPlay, preroll) {
  // speakText.stop() latches speakMuted so leftover cascade TTS dies.
  // Cascade unmutes before its next play. S2S must do the same or her
  // audio is dropped after the first speech_started.
  unmuteSpeakOutput()
  onPlay?.()
  const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (preroll && !preroll.flushed) {
    preroll.chunks.push(chunk)
    preroll.samples += Math.floor(chunk.byteLength / 2)
    if (preroll.samples < PREROLL_SAMPLES) return
    const merged = concatPcm(preroll.chunks)
    preroll.chunks = []
    preroll.flushed = true
    void playPcmChunk(merged, 24000, 1, { fade: false })
    return
  }
  void playPcmChunk(chunk, 24000, 1, { fade: false })
}

function playBase64Pcm(b64, onPlay, preroll) {
  if (!b64) return
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  playS2SPcm(bytes, onPlay, preroll)
}

/**
 * Native Grok Voice speech-to-speech Live path.
 * Mic PCM ↔ /voice/api/realtime/stream. No STT or TTS cascade.
 */
export function useGrokVoiceS2S({
  conversationId,
  agentUsername,
  model,
  messages,
  userId,
  speakEnabled = true,
  onFallback,
} = {}) {
  const [callState, setCallState] = useState('idle')
  const [callError, setCallError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [lastHeard, setLastHeard] = useState('')
  const [lastReply, setLastReply] = useState('')
  const activeRef = useRef(false)
  const mutedRef = useRef(false)
  const speakEnabledRef = useRef(speakEnabled)
  const socketRef = useRef(null)
  const captureRef = useRef(null)
  const retryTimerRef = useRef(null)
  const streamAttemptsRef = useRef(0)
  const connectRef = useRef(null)
  const retryRef = useRef(null)
  const holdMicRef = useRef(false)
  const lastSpokenRef = useRef({ text: '', at: 0 })
  const heardAudioRef = useRef(false)
  const droppedReplyRef = useRef('')
  const lastPlayAtRef = useRef(0)
  const fallbackTimerRef = useRef(null)
  const pingTimerRef = useRef(null)
  const releaseTimerRef = useRef(null)
  const prerollRef = useRef({ chunks: [], samples: 0, flushed: false })
  const optsRef = useRef({ conversationId, agentUsername, model, messages, userId })
  const onFallbackRef = useRef(onFallback)
  speakEnabledRef.current = speakEnabled
  onFallbackRef.current = onFallback
  optsRef.current = { conversationId, agentUsername, model, messages, userId }

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
    if (pingTimerRef.current != null) {
      window.clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    captureRef.current?.stop?.()
    captureRef.current = null
    const socket = socketRef.current
    socketRef.current = null
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try { socket.close() } catch { /* noop */ }
    }
  }, [])

  const failCall = useCallback((kind, message, canRetry) => {
    if (onFallbackRef.current?.(kind, message)) {
      activeRef.current = false
      clearTimers()
      teardown()
      speakText.stop()
      streamAttemptsRef.current = 0
      emitLiveTrace('s2s.fallback', { kind, message, transport: 's2s' })
      setCallError(null)
      setCallState('idle')
      return
    }
    activeRef.current = false
    clearTimers()
    teardown()
    speakText.stop()
    streamAttemptsRef.current = 0
    emitLiveTrace('call.error', { kind, message, can_retry: canRetry ? 1 : 0, transport: 's2s' })
    setCallError({ kind, message, canRetry: !!canRetry })
    setCallState('error')
  }, [clearTimers, teardown])

  const sendJson = useCallback((payload) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }, [])

  const applyMicGate = useCallback(() => {
    const open = activeRef.current && !mutedRef.current && !holdMicRef.current
    captureRef.current?.setMicEnabled?.(open)
    sendJson({ type: 'mic', enabled: open })
    // Human mute may discard an unfinished user utterance. Clearing
    // while she is speaking is barge-in and clips her first/last word.
    if (!open && mutedRef.current) sendJson({ type: 'input_audio_buffer.clear' })
  }, [sendJson])

  const holdMicForSpeak = useCallback((text) => {
    holdMicRef.current = true
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    const spoken = String(text || '').trim()
    if (spoken) lastSpokenRef.current = { text: spoken, at: Date.now() }
    applyMicGate()
    setCallState('speaking')
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null
      if (!holdMicRef.current) return
      if (remainingSpeakMs() > 80 || Date.now() - lastPlayAtRef.current < 400) {
        holdMicForSpeak(lastSpokenRef.current.text)
        return
      }
      holdMicRef.current = false
      applyMicGate()
      if (activeRef.current && !mutedRef.current) setCallState('listening')
    }, 8000)
  }, [applyMicGate])

  const releaseMicAfterSpeak = useCallback(() => {
    const wait = Math.max(remainingSpeakMs(), SPEAK_RELEASE_MS)
    if (releaseTimerRef.current != null) window.clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null
      if (shouldHoldMicWhileSpeaking({ speaking: false, remainingMs: remainingSpeakMs() })) {
        releaseMicAfterSpeak()
        return
      }
      holdMicRef.current = false
      if (!activeRef.current) return
      applyMicGate()
      if (!mutedRef.current) setCallState('listening')
    }, wait)
  }, [applyMicGate])

  const connectSession = useCallback(() => {
    if (!activeRef.current) return
    teardown()
    setCallError(null)
    setCallState('connecting')
    const token = getAccessToken()
    const opts = optsRef.current
    let stream = null
    let context = null
    let source = null
    let processor = null
    let mute = null
    let ready = false
    let cancelled = false
    let micEnabled = !mutedRef.current

    const stopCapture = () => {
      cancelled = true
      try { source?.disconnect() } catch { /* noop */ }
      try { processor?.disconnect() } catch { /* noop */ }
      try { mute?.disconnect() } catch { /* noop */ }
      source = null
      processor = null
      mute = null
      if (stream) stream.getTracks().forEach((track) => track.stop())
      stream = null
      if (context) context.close().catch(() => {})
      context = null
    }

    const controller = {
      stop: stopCapture,
      setMicEnabled: (on) => {
        micEnabled = !!on
        const tracks = stream?.getAudioTracks?.() || []
        tracks.forEach((track) => { track.enabled = micEnabled })
      },
    }
    captureRef.current = controller

    const socket = new WebSocket(realtimeVoiceUrl())
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    socket.onopen = () => {
      if (cancelled || !activeRef.current) return
      socket.send(JSON.stringify({
        type: 'start',
        token,
        sample_rate: 24000,
        ...voiceCorrelation(),
        conversation_id: opts.conversationId || '',
        agent_username: opts.agentUsername || '',
        model: opts.model || '',
        history: historyToVoiceItems(opts.messages, opts.userId),
      }))
    }

    socket.onmessage = (event) => {
      if (cancelled || !activeRef.current) return
      if (typeof event.data !== 'string') {
        if (!heardAudioRef.current) emitLiveTrace('s2s.audio.start', { via: 'binary' })
        heardAudioRef.current = true
        holdMicForSpeak()
        if (speakEnabledRef.current) {
          playS2SPcm(new Uint8Array(event.data), () => { lastPlayAtRef.current = Date.now() }, prerollRef.current)
        } else emitLiveTrace('s2s.audio_drop', { reason: 'speak_off', via: 'binary' })
        return
      }
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      const type = String(msg.type || '')
      if (type === 'ready' || type === 'session.updated') {
        streamAttemptsRef.current = 0
        if (!mutedRef.current) setCallState('listening')
        emitLiveTrace('s2s.ready', {
          model: msg.model || opts.model || '',
          via: msg.via || '',
          tools: Array.isArray(msg.tools) ? msg.tools.length : 0,
        })
        if (pingTimerRef.current == null) {
          pingTimerRef.current = window.setInterval(() => {
            sendJson({ type: 'ping' })
          }, 20000)
        }
        return
      }
      if (type === 'error') {
        const err = new Error(msg.message || 'Live voice session failed.')
        err.code = msg.code
        const kind = classifyVoiceError(err)
        if (kind === 'no_mic' || kind === 'permission_denied') {
          failCall(kind, MIC_ERROR_MESSAGES[kind], false)
        } else if (msg.code === 'not_voice_agent') {
          failCall('not_voice_agent', 'This agent is not on Grok Voice.', false)
        } else {
          retryRef.current?.()
        }
        return
      }
      if (type === 'speech_started' || type === 'input_audio_buffer.speech_started') {
        // Echo of her speaker is not barge-in. Never cut a reply that is
        // still on the playhead — that was the start/end clip.
        if (holdMicRef.current || mutedRef.current) return
        if (remainingSpeakMs() > 80) return
        if (Date.now() - lastPlayAtRef.current < 2000) return
        interruptSpeakOutput()
        setCallState('listening')
        return
      }
      if (type === 'debug.user') {
        emitLiveTrace('s2s.user', { text: msg.text || '', via: 'proxy' })
        return
      }
      if (type === 'debug.assistant') {
        const text = String(msg.stt || msg.text || '').trim()
        if (text) {
          setLastReply(text)
          emitLiveTrace('s2s.assistant', { text, via: 'stt' })
        }
        return
      }
      if (type === 'debug.persist') {
        emitLiveTrace('s2s.persist', {
          role: msg.role || '',
          ok: msg.ok == null ? 1 : Number(msg.ok) ? 1 : 0,
          status: msg.status || 201,
          via: 'scli',
        })
        return
      }
      if (type === 'error' || type.startsWith('response.')) {
        if (type.startsWith('response.') && type !== 'response.output_audio.delta' && type !== 'response.audio.delta') {
          emitLiveTrace('s2s.event', { type })
        }
      }
      if (
        type === 'input_audio_transcription.delta'
        || type === 'conversation.item.input_audio_transcription.delta'
      ) {
        const text = String(msg.delta || msg.text || msg.transcript || '').trim()
        if (!text || mutedRef.current) return
        const surface = shouldSurfaceHeard(text, {
          muted: mutedRef.current || holdMicRef.current,
          lastSpoken: lastSpokenRef.current.text,
          spokenAt: lastSpokenRef.current.at,
        })
        if (!surface.ok) {
          if (surface.reason === 'echo') emitLiveTrace('s2s.echo_drop', { text: surface.text })
          return
        }
        setLastHeard(surface.text)
        return
      }
      if (
        type === 'input_audio_transcription.completed'
        || type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const text = String(msg.transcript || msg.text || '').trim()
        const surface = shouldSurfaceHeard(text, {
          muted: mutedRef.current || holdMicRef.current,
          lastSpoken: lastSpokenRef.current.text,
          spokenAt: lastSpokenRef.current.at,
        })
        if (!surface.ok) {
          if (surface.reason === 'echo') emitLiveTrace('s2s.echo_drop', { text: surface.text })
          return
        }
        setLastHeard(surface.text)
        emitLiveTrace('s2s.user', { text: surface.text })
        heardAudioRef.current = false
        prerollRef.current = { chunks: [], samples: 0, flushed: false }
        droppedReplyRef.current = ''
        setLastReply('')
        if (!mutedRef.current && !holdMicRef.current) setCallState('thinking')
        return
      }
      if (
        type === 'response.output_audio_transcript.delta'
        || type === 'response.audio_transcript.delta'
        || type === 'response.output_text.delta'
      ) {
        const text = String(msg.delta || msg.text || '')
        if (text) setLastReply((prev) => `${prev}${text}`)
        holdMicForSpeak(text)
        return
      }
      if (
        type === 'response.output_audio_transcript.done'
        || type === 'response.audio_transcript.done'
        || type === 'response.output_text.done'
      ) {
        const text = String(msg.transcript || msg.text || '').trim()
        if (text) {
          setLastReply(text)
          lastSpokenRef.current = { text, at: Date.now() }
          emitLiveTrace('s2s.assistant', { text })
        }
        holdMicForSpeak(text)
        if (text && speakEnabledRef.current && !heardAudioRef.current) {
          if (fallbackTimerRef.current != null) window.clearTimeout(fallbackTimerRef.current)
          fallbackTimerRef.current = window.setTimeout(() => {
            fallbackTimerRef.current = null
            if (!activeRef.current || heardAudioRef.current || !speakEnabledRef.current) return
            emitLiveTrace('s2s.tts_fallback', { text })
            unmuteSpeakOutput()
            void speakText(text)
          }, 700)
        }
        return
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        if (!heardAudioRef.current) emitLiveTrace('s2s.audio.start', {})
        heardAudioRef.current = true
        if (fallbackTimerRef.current != null) {
          window.clearTimeout(fallbackTimerRef.current)
          fallbackTimerRef.current = null
        }
        holdMicForSpeak()
        if (!speakEnabledRef.current) {
          droppedReplyRef.current = lastSpokenRef.current.text || droppedReplyRef.current
          emitLiveTrace('s2s.audio_drop', { reason: 'speak_off' })
          return
        }
        if (isSpeakOutputMuted()) emitLiveTrace('s2s.audio_unmute', { reason: 'after_stop' })
        playBase64Pcm(msg.delta || msg.audio, () => { lastPlayAtRef.current = Date.now() }, prerollRef.current)
        return
      }
      if (type === 'response.done' || type === 'response.completed') {
        releaseMicAfterSpeak()
      }
    }

    socket.onerror = () => {
      if (cancelled || !activeRef.current) return
      retryRef.current?.()
    }
    socket.onclose = () => {
      if (cancelled || !activeRef.current) return
      retryRef.current?.()
    }

    void (async () => {
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (cancelled || !activeRef.current) {
          acquired.getTracks().forEach((track) => track.stop())
          return
        }
        stream = acquired
        const AudioContextImpl = window.AudioContext || window.webkitAudioContext
        context = new AudioContextImpl({ sampleRate: 24000 })
        await context.resume()
        if (cancelled) { stopCapture(); return }
        source = context.createMediaStreamSource(stream)
        processor = context.createScriptProcessor(2048, 1, 1)
        mute = context.createGain()
        mute.gain.value = 0
        processor.connect(mute)
        mute.connect(context.destination)
        processor.onaudioprocess = (audioEvent) => {
          if (cancelled || socket.readyState !== WebSocket.OPEN || !ready) return
          const samples = audioEvent.inputBuffer.getChannelData(0)
          if (!micEnabled) {
            socket.send(new Int16Array(samples.length).buffer)
            return
          }
          socket.send(toPcm16(samples))
        }
        const markReady = () => {
          ready = true
          source?.connect(processor)
          if (activeRef.current && !mutedRef.current) setCallState('listening')
        }
        if (socket.readyState === WebSocket.OPEN) {
          /* ready event from server arms listening; still start capture graph */
        }
        socket.addEventListener('message', function onReady(ev) {
          if (typeof ev.data !== 'string') return
          try {
            const parsed = JSON.parse(ev.data)
            if (parsed.type === 'ready' || parsed.type === 'session.updated') {
              socket.removeEventListener('message', onReady)
              markReady()
            }
          } catch { /* ignore */ }
        })
      } catch (error) {
        const kind = classifyVoiceError(error)
        if (kind === 'no_mic' || kind === 'permission_denied') {
          failCall(kind, MIC_ERROR_MESSAGES[kind], false)
        } else {
          retryRef.current?.()
        }
      }
    })()
  }, [failCall, holdMicForSpeak, releaseMicAfterSpeak, sendJson, teardown])
  connectRef.current = connectSession

  const scheduleRetry = useCallback(() => {
    if (!activeRef.current) return
    const failed = streamAttemptsRef.current + 1
    streamAttemptsRef.current = failed
    teardown()
    setCallState('connecting')
    const delay = Math.min(8000, VOICE_STREAM_BASE_BACKOFF_MS * (2 ** Math.min(failed - 1, 4)))
    emitLiveTrace('s2s.reconnect', { attempt: failed, delay_ms: delay })
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current)
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      if (activeRef.current) connectRef.current?.()
    }, delay)
  }, [teardown])
  retryRef.current = scheduleRetry

  useEffect(() => {
    if (!conversationId) return
    sendJson({ type: 'conversation', conversation_id: conversationId })
  }, [conversationId, sendJson])

  const startCall = useCallback((overrides = {}) => {
    if (activeRef.current) return
    if (overrides.conversationId) {
      optsRef.current = { ...optsRef.current, conversationId: overrides.conversationId }
    }
    activeRef.current = true
    mutedRef.current = false
    holdMicRef.current = false
    lastSpokenRef.current = { text: '', at: 0 }
    heardAudioRef.current = false
    prerollRef.current = { chunks: [], samples: 0, flushed: false }
    streamAttemptsRef.current = 0
    beginLiveCall()
    emitLiveTrace('call.start', { transport: 's2s' })
    setMuted(false)
    setLastHeard('')
    setLastReply('')
    setCallError(null)
    warmSpeakOutput()
    unmuteSpeakOutput()
    connectRef.current?.()
  }, [])

  const endCall = useCallback(() => {
    activeRef.current = false
    mutedRef.current = false
    clearTimers()
    teardown()
    speakText.stop()
    streamAttemptsRef.current = 0
    endLiveCall()
    setMuted(false)
    setLastHeard('')
    setLastReply('')
    setCallError(null)
    setCallState('idle')
  }, [clearTimers, teardown])

  const toggleMute = useCallback(() => {
    if (!activeRef.current) return
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    emitLiveTrace(next ? 'mic.mute' : 'mic.unmute', { transport: 's2s' })
    applyMicGate()
  }, [applyMicGate])

  const cancelSpeak = useCallback(() => {
    emitLiveTrace('tts.cancel', { remaining_ms: remainingSpeakMs(), transport: 's2s' })
    speakText.stop()
    sendJson({ type: 'response.cancel' })
    holdMicRef.current = false
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    applyMicGate()
    if (activeRef.current && !mutedRef.current) setCallState('listening')
  }, [applyMicGate, sendJson])

  const retryCall = useCallback(() => {
    activeRef.current = false
    mutedRef.current = false
    clearTimers()
    teardown()
    speakText.stop()
    streamAttemptsRef.current = 0
    setMuted(false)
    setCallError(null)
    activeRef.current = true
    connectRef.current?.()
  }, [clearTimers, teardown])

  useEffect(() => {
    if (!activeRef.current) return
    if (!speakEnabled) {
      cancelSpeak()
      return
    }
    unmuteSpeakOutput()
    const dropped = droppedReplyRef.current
    if (!dropped) return
    droppedReplyRef.current = ''
    emitLiveTrace('s2s.replay', { text: dropped })
    holdMicForSpeak(dropped)
    void speakText(dropped)
  }, [speakEnabled, cancelSpeak, holdMicForSpeak])

  useEffect(() => () => {
    activeRef.current = false
    clearTimers()
    teardown()
    speakText.stop()
  }, [clearTimers, teardown])

  return {
    callState,
    callError,
    muted,
    lastHeard,
    lastReply,
    transport: 's2s',
    startCall,
    endCall,
    retryCall,
    toggleMute,
    notifyReply: async () => {},
    beginSpeak: () => {},
    endSpeak: async () => {},
    cancelSpeak,
    resumeListen: () => {},
    isCallActive: () => activeRef.current,
  }
}
