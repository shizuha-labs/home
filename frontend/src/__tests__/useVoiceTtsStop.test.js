/**
 * Voice replies off must kill in-flight TTS, including chunks that finish
 * decoding after the click. Production order: play PCM → stop → late chunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  interruptSpeakOutput,
  isSpeakOutputMuted,
  playAudioChunk,
  playPcmChunk,
  remainingSpeakMs,
  resetSpeakOutputForTests,
  setUserSpeakEnabled,
  speakText,
  unmuteSpeakOutput,
} from '../hooks/useVoice'

function pcmB64(sampleCount = 8) {
  const bytes = new Uint8Array(sampleCount * 2)
  return btoa(String.fromCharCode(...bytes))
}

function installFakeAudioContext() {
  const started = []
  class FakeBufferSource {
    constructor() {
      this.started = false
      this.stopped = false
      this.buffer = null
      this.playbackRate = { value: 1 }
      this.onended = null
    }

    connect() { return this }

    disconnect() { return this }

    start() {
      this.started = true
      started.push(this)
    }

    stop() {
      this.stopped = true
      this.onended?.()
    }
  }

  class FakeGain {
    constructor() {
      this.gain = {
        value: 1,
        setValueAtTime(v) { this.value = v },
        cancelScheduledValues() {},
      }
    }

    connect() { return this }
  }

  class FakeCtx {
    constructor() {
      this.currentTime = 1
      this.state = 'running'
      this.destination = {}
    }

    createGain() { return new FakeGain() }

    createBufferSource() { return new FakeBufferSource() }

    createBuffer(_ch, len, rate) {
      return {
        duration: len / rate,
        getChannelData: () => new Float32Array(len),
      }
    }

    decodeAudioData() {
      return Promise.resolve({
        duration: 0.2,
        getChannelData: () => new Float32Array(8),
      })
    }

    resume() { this.state = 'running'; return Promise.resolve() }

    suspend() { this.state = 'suspended'; return Promise.resolve() }
  }

  vi.stubGlobal('AudioContext', FakeCtx)
  return { started }
}

describe('TTS stop / Voice replies off', () => {
  beforeEach(() => {
    resetSpeakOutputForTests()
  })

  afterEach(() => {
    resetSpeakOutputForTests()
    vi.unstubAllGlobals()
  })

  it('mutes output and ignores chunks scheduled after stop', async () => {
    const { started } = installFakeAudioContext()
    resetSpeakOutputForTests()
    const pending = playAudioChunk(pcmB64(), 'audio/pcm', 24000)
    expect(started.some((s) => s.started && !s.stopped)).toBe(true)

    speakText.stop()
    await pending
    expect(isSpeakOutputMuted()).toBe(true)
    expect(remainingSpeakMs()).toBe(0)
    expect(started.every((s) => s.stopped)).toBe(true)

    const before = started.length
    await playAudioChunk(pcmB64(), 'audio/pcm', 24000)
    expect(started.length).toBe(before)
    expect(isSpeakOutputMuted()).toBe(true)
  })

  it('drops decodeAudioData completions that land after stop', async () => {
    let resolveDecode
    const started = []
    class FakeBufferSource {
      constructor() {
        this.playbackRate = { value: 1 }
        this.onended = null
      }
      connect() { return this }
      start() { started.push(this) }
      stop() { this.onended?.() }
    }
    class FakeGain {
      constructor() {
        this.gain = { value: 1, setValueAtTime(v) { this.value = v }, cancelScheduledValues() {} }
      }
      connect() { return this }
    }
    class FakeCtx {
      currentTime = 1
      state = 'running'
      destination = {}
      createGain() { return new FakeGain() }
      createBufferSource() { return new FakeBufferSource() }
      decodeAudioData() {
        return new Promise((resolve) => { resolveDecode = resolve })
      }
      resume() { this.state = 'running'; return Promise.resolve() }
      suspend() { this.state = 'suspended'; return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', FakeCtx)
    resetSpeakOutputForTests()

    const pending = playAudioChunk(pcmB64(), 'audio/mpeg', 24000)
    expect(typeof resolveDecode).toBe('function')
    speakText.stop()
    resolveDecode({ duration: 0.2, getChannelData: () => new Float32Array(8) })
    await pending
    expect(started).toHaveLength(0)
    expect(isSpeakOutputMuted()).toBe(true)
  })

  it('does not start HTML-fallback audio after stop', async () => {
    const play = vi.fn()
    class FakeAudio {
      constructor() {
        this.playbackRate = 1
        this.volume = 1
        this.src = 'blob:fake'
        this.onended = null
        this.onerror = null
      }

      play() {
        play()
        return Promise.resolve()
      }

      pause() {}
    }
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    resetSpeakOutputForTests()

    speakText.stop()
    await playAudioChunk(pcmB64(), 'audio/mpeg', 24000)
    expect(play).not.toHaveBeenCalled()
    expect(isSpeakOutputMuted()).toBe(true)
  })

  it('S2S can play again after stop once it unmutes the shared speaker', async () => {
    const { started } = installFakeAudioContext()
    resetSpeakOutputForTests()
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    speakText.stop()
    expect(isSpeakOutputMuted()).toBe(true)
    const before = started.length
    unmuteSpeakOutput()
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    expect(isSpeakOutputMuted()).toBe(false)
    expect(started.length).toBeGreaterThan(before)
  })

  it('user mute stays latched through unmuteSpeakOutput and leftover speakText', async () => {
    const { started } = installFakeAudioContext()
    resetSpeakOutputForTests()
    setUserSpeakEnabled(false)
    speakText.stop()
    unmuteSpeakOutput()
    expect(isSpeakOutputMuted()).toBe(true)
    const before = started.length
    await speakText('They should not have been on you.')
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    expect(started.length).toBe(before)
    setUserSpeakEnabled(true)
    unmuteSpeakOutput()
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    expect(started.length).toBeGreaterThan(before)
  })

  it('barge-in interrupt does not latch the speaker mute', async () => {
    const { started } = installFakeAudioContext()
    resetSpeakOutputForTests()
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    interruptSpeakOutput()
    expect(isSpeakOutputMuted()).toBe(false)
    const before = started.length
    void playPcmChunk(new Uint8Array(16), 24000, 1)
    expect(started.length).toBeGreaterThan(before)
  })
})
