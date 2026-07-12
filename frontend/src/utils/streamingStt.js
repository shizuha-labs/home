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

  const emitIdle = () => {
    if (idleDelivered) return
    idleDelivered = true
    onState?.('idle')
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
    onFinal?.(clean, event)
  }

  const controller = {
    stop: () => {
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
        if (text) onPartial?.(text, timedEvent)
        if (event.speech_final) {
          finishCapture(true)
          deliverFinal(text, timedEvent)
        }
        return
      }
      if (event.type === 'transcript.done') {
        deliverFinal(event.text, event)
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
