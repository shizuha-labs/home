import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/auth'
import { beginLiveCall, emitLiveTrace, endLiveCall, voiceCorrelation } from '../utils/liveTrace'
import { historyToVoiceItems, realtimeVoiceUrl } from '../utils/grokVoice'
import {
  classifyVoiceError,
  playPcmChunk,
  speakText,
  warmSpeakOutput,
  remainingSpeakMs,
  VOICE_STREAM_BASE_BACKOFF_MS,
  VOICE_STREAM_MAX_RETRIES,
} from './useVoice'

const MIC_ERROR_MESSAGES = {
  no_mic: 'No microphone found. Connect a mic or type instead.',
  permission_denied: 'Microphone permission denied. Allow mic access in your browser settings, then try again.',
}

const STREAM_UNAVAILABLE_MESSAGE = 'Voice is temporarily unavailable. Try again in a moment.'

function toPcm16(samples) {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return pcm.buffer
}

function playBase64Pcm(b64) {
  if (!b64) return
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  void playPcmChunk(bytes, 24000, 1)
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
  const optsRef = useRef({ conversationId, agentUsername, model, messages, userId })
  speakEnabledRef.current = speakEnabled
  optsRef.current = { conversationId, agentUsername, model, messages, userId }

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
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
        if (speakEnabledRef.current) void playPcmChunk(new Uint8Array(event.data), 24000, 1)
        return
      }
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      const type = String(msg.type || '')
      if (type === 'ready' || type === 'session.updated') {
        streamAttemptsRef.current = 0
        if (!mutedRef.current) setCallState('listening')
        emitLiveTrace('s2s.ready', { model: msg.model || opts.model || '' })
        return
      }
      if (type === 'error') {
        const err = new Error(msg.message || 'Live voice session failed.')
        err.code = msg.code
        const kind = classifyVoiceError(err)
        if (kind === 'no_mic' || kind === 'permission_denied') {
          failCall(kind, MIC_ERROR_MESSAGES[kind], false)
        } else if (msg.code === 'not_voice_agent') {
          failCall('stream_unavailable', 'This agent is not on Grok Voice.', false)
        } else {
          retryRef.current?.()
        }
        return
      }
      if (type === 'speech_started' || type === 'input_audio_buffer.speech_started') {
        speakText.stop()
        setCallState(mutedRef.current ? 'listening' : 'listening')
        return
      }
      if (
        type === 'input_audio_transcription.delta'
        || type === 'conversation.item.input_audio_transcription.delta'
      ) {
        const text = String(msg.delta || msg.text || msg.transcript || '').trim()
        if (text && !mutedRef.current) setLastHeard(text)
        return
      }
      if (
        type === 'input_audio_transcription.completed'
        || type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const text = String(msg.transcript || msg.text || '').trim()
        if (text) {
          setLastHeard(text)
          emitLiveTrace('s2s.user', { text })
        }
        if (!mutedRef.current) setCallState('thinking')
        return
      }
      if (
        type === 'response.output_audio_transcript.delta'
        || type === 'response.audio_transcript.delta'
        || type === 'response.output_text.delta'
      ) {
        const text = String(msg.delta || msg.text || '').trim()
        if (text) {
          setLastReply((prev) => `${prev}${msg.delta || msg.text || ''}`)
          setCallState('speaking')
        }
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
          emitLiveTrace('s2s.assistant', { text })
        }
        return
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        if (speakEnabledRef.current) playBase64Pcm(msg.delta || msg.audio)
        setCallState('speaking')
        return
      }
      if (type === 'response.done' || type === 'response.completed') {
        if (!mutedRef.current) setCallState('listening')
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
  }, [failCall, teardown])
  connectRef.current = connectSession

  const scheduleRetry = useCallback(() => {
    if (!activeRef.current) return
    const failed = streamAttemptsRef.current + 1
    streamAttemptsRef.current = failed
    teardown()
    if (failed > VOICE_STREAM_MAX_RETRIES) {
      failCall('stream_unavailable', STREAM_UNAVAILABLE_MESSAGE, true)
      return
    }
    setCallState('connecting')
    const delay = VOICE_STREAM_BASE_BACKOFF_MS * (2 ** (failed - 1))
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current)
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      if (activeRef.current) connectRef.current?.()
    }, delay)
  }, [failCall, teardown])
  retryRef.current = scheduleRetry

  const startCall = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    mutedRef.current = false
    streamAttemptsRef.current = 0
    beginLiveCall()
    emitLiveTrace('call.start', { transport: 's2s' })
    setMuted(false)
    setLastHeard('')
    setLastReply('')
    setCallError(null)
    warmSpeakOutput()
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
    captureRef.current?.setMicEnabled?.(!next)
    sendJson({ type: 'mic', enabled: !next })
  }, [sendJson])

  const cancelSpeak = useCallback(() => {
    emitLiveTrace('tts.cancel', { remaining_ms: remainingSpeakMs(), transport: 's2s' })
    speakText.stop()
    sendJson({ type: 'response.cancel' })
    if (activeRef.current && !mutedRef.current) setCallState('listening')
  }, [sendJson])

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
    if (!speakEnabled) cancelSpeak()
  }, [speakEnabled, cancelSpeak])

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
