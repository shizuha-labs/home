/** After a clearly finished question, wait this long for a late clause. */
export const STT_COMPLETE_HANGOVER_MS = 2200
/** Human-like pause after a mid-thought, digit string, or period-only clause. */
export const STT_INCOMPLETE_HANGOVER_MS = 4000
/** After mute, commit soon — mute is “I’m done talking”, not “throw this away”. */
export const STT_MUTE_COMMIT_MS = 400

const INCOMPLETE_TAIL = /\b(a|an|and|at|but|check|for|if|in|of|on|or|so|the|to|with|my|your|this|that|these|those|first|second|third|want|see|look|tell|give|pull|open|about|task|personally|perhaps|maybe|just|please|then|also)$/i

/** True when the transcript is a mid-thought, not a finished command.
 * Grok often appends a period on an unfinished clause, so `.` is not a stop. */
export function utteranceLooksIncomplete(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return true
  const stripped = t.replace(/[.]+$/, '')
  if (/\b\d(?:\s+\d)+\b/.test(stripped)) return true
  if (/[?!…]$/.test(t) && stripped.split(/\s+/).length >= 2) return false
  if (INCOMPLETE_TAIL.test(stripped)) return true
  return true
}

export function sttCommitHangoverMs(text) {
  return utteranceLooksIncomplete(text) ? STT_INCOMPLETE_HANGOVER_MS : STT_COMPLETE_HANGOVER_MS
}

/** Grok often resets the running transcript after a mid-thought pause.
 * A new partial that does not extend the pending clause is still one turn. */
export function stitchHeard(prev, next) {
  const a = String(prev || '').replace(/\s+/g, ' ').trim()
  const b = String(next || '').replace(/\s+/g, ' ').trim()
  if (!a) return b
  if (!b) return a
  if (b === a) return b
  if (b.startsWith(a)) return b
  if (a.startsWith(b) && a.length > b.length) return a
  if (a.toLowerCase().includes(b.toLowerCase())) return a
  if (b.toLowerCase().includes(a.toLowerCase())) return b
  const aWords = a.split(' ')
  const bWords = b.split(' ')
  for (let n = Math.min(aWords.length, bWords.length); n >= 2; n -= 1) {
    if (aWords.slice(-n).join(' ').toLowerCase() === bWords.slice(0, n).join(' ').toLowerCase()) {
      return [...aWords, ...bWords.slice(n)].join(' ')
    }
  }
  const max = Math.min(a.length, b.length)
  for (let n = max; n >= 8; n -= 1) {
    if (a.slice(-n).toLowerCase() === b.slice(0, n).toLowerCase()) {
      return `${a}${b.slice(n)}`.replace(/\s+/g, ' ').trim()
    }
  }
  return `${a} ${b}`
}

export function isTranscriptExtension(prev, next) {
  const a = String(prev || '').replace(/\s+/g, ' ').trim()
  const b = String(next || '').replace(/\s+/g, ' ').trim()
  if (!a || !b) return true
  return b.startsWith(a) || a.startsWith(b)
}

const wsUrl = () => {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/voice/api/stt/stream`
}

const toPcm16 = (samples) => {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return pcm.buffer
}

/**
 * Start microphone streaming and return an abortable controller synchronously.
 * Permission/context startup continues in the background, checking cancellation
 * after every await before it can create or connect the next resource.
 */
export function startStreamingStt({ token, onPartial, onFinal, onDone, onState, onError }) {
  let stream = null
  let context = null
  let source = null
  let processor = null
  let mute = null
  let socket = null
  let ready = false
  let captureEnded = false
  let cancelled = false
  let finalDelivered = false
  let idleDelivered = false
  let errorDelivered = false
  let closeTimer = null
  let firstAudioAt = 0
  let firstPartialMs = null
  let lastLoudAt = 0
  let commitTimer = null
  let pendingFinal = null
  let lastPartial = ''
  let micEnabled = true

  const emitIdle = () => {
    if (idleDelivered) return
    idleDelivered = true
    onState?.('idle')
  }

  const clearCommit = () => {
    if (commitTimer != null) window.clearTimeout(commitTimer)
    commitTimer = null
    pendingFinal = null
  }

  const stopResources = () => {
    try { source?.disconnect() } catch { /* already disconnected */ }
    try { processor?.disconnect() } catch { /* already disconnected */ }
    try { mute?.disconnect() } catch { /* already disconnected */ }
    source = null
    processor = null
    mute = null
    if (stream) stream.getTracks().forEach((track) => track.stop())
    stream = null
    if (context) context.close().catch(() => {})
    context = null
  }

  const close = () => {
    cancelled = true
    captureEnded = true
    clearCommit()
    if (closeTimer) window.clearTimeout(closeTimer)
    closeTimer = null
    stopResources()
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try { socket.close() } catch { /* noop */ }
    }
    socket = null
    emitIdle()
  }

  const reportError = (error) => {
    if (cancelled || errorDelivered) return
    errorDelivered = true
    onError?.(error, { ready })
  }

  const finishCapture = (flush = true) => {
    if (captureEnded) return
    captureEnded = true
    stopResources()
    if (!flush) {
      close()
      return
    }
    onState?.('transcribing')
    if (socket?.readyState === WebSocket.OPEN && ready) {
      socket.send(JSON.stringify({ type: 'audio.done' }))
      closeTimer = window.setTimeout(close, 5000)
    }
    // If the socket is still connecting, transcript.created handles the
    // pending flush without ever reconnecting the microphone graph.
  }

  const deliverFinal = (text, event) => {
    const clean = String(text || '').trim()
    if (!clean || finalDelivered) return
    finalDelivered = true
    clearCommit()
    onFinal?.(clean, event)
  }

  const commitPending = () => {
    const pending = pendingFinal
    commitTimer = null
    pendingFinal = null
    if (!pending || finalDelivered) return
    finishCapture(true)
    deliverFinal(pending.text, pending.event)
  }

  const armCommit = (text, event, delayMs = sttCommitHangoverMs(text)) => {
    if (finalDelivered || cancelled) return
    if (commitTimer != null) window.clearTimeout(commitTimer)
    pendingFinal = { text, event }
    commitTimer = window.setTimeout(commitPending, delayMs)
  }

  const setMicEnabled = (on) => {
    micEnabled = !!on
    const tracks = stream?.getAudioTracks?.() || stream?.getTracks?.() || []
    tracks.forEach((track) => { track.enabled = micEnabled })
  }

  const hintTurnComplete = () => {
    if (finalDelivered || cancelled) return
    const text = (pendingFinal?.text || lastPartial || '').trim()
    if (!text) return
    armCommit(text, pendingFinal?.event || { type: 'transcript.partial', text, speech_final: true }, STT_MUTE_COMMIT_MS)
  }

  const controller = {
    setMicEnabled,
    hintTurnComplete,
    stop: () => {
      if (pendingFinal) {
        const pending = pendingFinal
        clearCommit()
        finishCapture(true)
        deliverFinal(pending.text, pending.event)
        return
      }
      if (!ready) {
        cancelled = true
        close()
      } else {
        finishCapture(true)
      }
    },
    cancel: () => {
      cancelled = true
      finishCapture(false)
      close()
    },
  }

  onState?.('connecting')
  void (async () => {
    if (!token) throw new Error('missing access token')
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    stream = acquired
    if (cancelled) { stopResources(); return }

    const AudioContextImpl = window.AudioContext || window.webkitAudioContext
    context = new AudioContextImpl({ sampleRate: 16000 })
    await context.resume()
    if (cancelled) { stopResources(); return }

    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(2048, 1, 1)
    mute = context.createGain()
    mute.gain.value = 0
    processor.connect(mute)
    mute.connect(context.destination)
    if (cancelled) { stopResources(); return }

    socket = new WebSocket(wsUrl())
    socket.binaryType = 'arraybuffer'
    processor.onaudioprocess = (event) => {
      if (!ready || captureEnded || socket?.readyState !== WebSocket.OPEN) return
      const samples = event.inputBuffer.getChannelData(0)
      if (!micEnabled) {
        socket.send(new Int16Array(samples.length).buffer)
        return
      }
      const now = performance.now()
      if (!firstAudioAt) firstAudioAt = now
      let sum = 0
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
      if (Math.sqrt(sum / samples.length) > 0.018) lastLoudAt = now
      socket.send(toPcm16(samples))
    }
    socket.onopen = () => {
      if (cancelled) { close(); return }
      socket.send(JSON.stringify({
        type: 'start',
        token,
        sample_rate: context?.sampleRate || 16000,
        language: navigator.language || 'en',
      }))
    }
    socket.onmessage = ({ data }) => {
      if (cancelled) return
      let event
      try { event = JSON.parse(data) } catch { return }
      if (event.type === 'transcript.created') {
        ready = true
        if (captureEnded) {
          socket.send(JSON.stringify({ type: 'audio.done' }))
          closeTimer = window.setTimeout(close, 5000)
        } else {
          source?.connect(processor)
          onState?.('listening')
        }
        return
      }
      if (event.type === 'transcript.partial') {
        const now = performance.now()
        if (firstPartialMs == null && firstAudioAt) {
          firstPartialMs = Math.round(now - firstAudioAt)
        }
        const timedEvent = {
          ...event,
          timing: {
            first_pcm_to_partial_ms: firstPartialMs,
            silence_to_final_ms: event.speech_final && lastLoudAt
              ? Math.round(now - lastLoudAt)
              : null,
          },
        }
        const text = String(event.text || '').trim()
        if (!text) return
        const stitched = pendingFinal ? stitchHeard(pendingFinal.text, text) : text
        lastPartial = stitched
        onPartial?.(stitched, timedEvent)
        if (event.speech_final) {
          // Do not tear the mic down on the first VAD silence. Grok's
          // speech_final can fire mid-clause; hangover + Smart Turn wait
          // for the rest of the sentence (industry endpointing).
          armCommit(stitched, timedEvent)
        } else if (pendingFinal && !isTranscriptExtension(pendingFinal.text, text)) {
          // New clause after a pause — keep one turn, refresh hangover.
          armCommit(stitched, timedEvent)
        } else if (pendingFinal) {
          clearCommit()
        }
        return
      }
      if (event.type === 'transcript.done') {
        const text = stitchHeard(pendingFinal?.text || lastPartial, event.text)
        deliverFinal(text, event)
        onDone?.(event)
        close()
        return
      }
      if (event.type === 'error') {
        reportError(new Error(event.message || 'Streaming transcription failed.'))
        close()
      }
    }
    socket.onerror = () => {
      reportError(new Error('Streaming transcription connection failed.'))
      close()
    }
    socket.onclose = () => {
      stopResources()
      emitIdle()
    }
  })().catch((error) => {
    reportError(error)
    close()
  })

  return controller
}
