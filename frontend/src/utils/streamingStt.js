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
 * Open the authenticated Shizuha streaming-STT proxy and feed it microphone
 * PCM. The returned controller is available immediately, so a second mic click
 * can stop capture even while the upstream session is still becoming ready.
 */
export async function startStreamingStt({ token, onPartial, onFinal, onDone, onState, onError }) {
  if (!token) throw new Error('missing access token')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext
  const context = new AudioContextImpl({ sampleRate: 16000 })
  await context.resume()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(2048, 1, 1)
  const mute = context.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(context.destination)

  const socket = new WebSocket(wsUrl())
  socket.binaryType = 'arraybuffer'
  let ready = false
  let captureEnded = false
  let finalDelivered = false
  let closed = false
  let closeTimer = null

  const stopTracks = () => {
    try { source.disconnect() } catch { /* already disconnected */ }
    try { processor.disconnect() } catch { /* already disconnected */ }
    try { mute.disconnect() } catch { /* already disconnected */ }
    stream.getTracks().forEach((track) => track.stop())
    context.close().catch(() => {})
  }

  const close = () => {
    if (closed) return
    closed = true
    if (closeTimer) window.clearTimeout(closeTimer)
    stopTracks()
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try { socket.close() } catch { /* noop */ }
    }
  }

  const finishCapture = (flush = true) => {
    if (captureEnded) return
    captureEnded = true
    stopTracks()
    onState?.('transcribing')
    if (flush && socket.readyState === WebSocket.OPEN && ready) {
      socket.send(JSON.stringify({ type: 'audio.done' }))
      closeTimer = window.setTimeout(close, 5000)
    } else if (!flush) {
      close()
    }
  }

  const deliverFinal = (text, event) => {
    const clean = String(text || '').trim()
    if (!clean || finalDelivered) return
    finalDelivered = true
    onFinal?.(clean, event)
  }

  processor.onaudioprocess = (event) => {
    if (!ready || captureEnded || socket.readyState !== WebSocket.OPEN) return
    socket.send(toPcm16(event.inputBuffer.getChannelData(0)))
  }

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'start',
      token,
      sample_rate: context.sampleRate,
      language: navigator.language || 'en',
    }))
  }
  socket.onmessage = ({ data }) => {
    let event
    try { event = JSON.parse(data) } catch { return }
    if (event.type === 'transcript.created') {
      ready = true
      source.connect(processor)
      onState?.('listening')
      return
    }
    if (event.type === 'transcript.partial') {
      const text = String(event.text || '').trim()
      if (text) onPartial?.(text, event)
      if (event.speech_final) {
        finishCapture(true)
        deliverFinal(text, event)
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
      onError?.(new Error(event.message || 'Streaming transcription failed.'), { ready })
      close()
    }
  }
  socket.onerror = () => {
    onError?.(new Error('Streaming transcription connection failed.'), { ready })
    close()
  }
  socket.onclose = () => {
    if (!closed) {
      closed = true
      stopTracks()
    }
    onState?.('idle')
  }

  return {
    stop: () => finishCapture(true),
    cancel: () => finishCapture(false),
  }
}
