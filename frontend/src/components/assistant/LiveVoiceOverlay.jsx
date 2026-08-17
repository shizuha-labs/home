import LiveWaveformIcon from './LiveWaveformIcon'
import TtsSpeedButton from './TtsSpeedButton'
import { getLiveTraceContext } from '../../utils/liveTrace'

/**
 * Compact live-voice HUD. Talk, type, and keep dashboard + chat visible
 * at once — never a fullscreen cover. Wrapper is pointer-events-none so
 * clicks and keyboard reach the page; only the chip is interactive.
 */
export default function LiveVoiceOverlay({
  agentLabel = 'Agent',
  callState = 'listening',
  muted = false,
  lastHeard = '',
  lastReply = '',
  error = null,
  speakEnabled = false,
  onToggleSpeak,
  onToggleMute,
  onEnd,
  onRetry,
  ttsSpeed,
  onCycleSpeed,
  nativeVoice = false,
}) {
  const label =
    callState === 'connecting' ? 'Connecting'
      : callState === 'listening' ? 'Listening'
        : callState === 'thinking' ? 'Thinking'
          : callState === 'speaking' ? 'Speaking'
            : callState === 'error' ? 'Unavailable'
              : 'Live'
  const orbTone =
    callState === 'speaking' ? 'from-violet-400 via-fuchsia-400 to-amber-300'
      : callState === 'thinking' ? 'from-indigo-400 via-brand-400 to-sky-300'
        : callState === 'error' ? 'from-amber-400 via-orange-400 to-rose-300'
          : 'from-sky-300 via-brand-400 to-violet-400'
  const orbScale =
    callState === 'speaking' ? 'scale-110'
      : callState === 'listening' && !muted ? 'scale-105'
        : 'scale-100'
  const caption = error
    || lastHeard
    || lastReply
    || 'Talk, type, and watch the dashboard at once.'

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[7.5rem] z-[55] flex justify-center px-3 sm:justify-end sm:px-5"
      data-testid="live-voice-overlay"
      data-mode="hud"
      data-call-state={callState}
      data-transport={nativeVoice ? 's2s' : 'cascade'}
    >
      <div
        role="region"
        aria-label="Live voice"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-[24rem] items-center gap-3 rounded-2xl border border-white/10 bg-gray-950 px-3 py-2 text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
      >
        <div className={`relative shrink-0 transition-transform duration-500 ${orbScale}`}>
          <div className={`absolute -inset-2 rounded-full bg-gradient-to-br ${orbTone} opacity-50 blur-md`} />
          <div className={`relative h-11 w-11 rounded-full bg-gradient-to-br ${orbTone} shadow-[0_0_24px_rgba(129,140,248,0.45)]`}>
            <div className="absolute inset-[18%] rounded-full bg-gray-950/70 backdrop-blur-sm" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {nativeVoice ? 'Voice' : 'Live'}
            </span>
            <span
              data-testid="live-voice-state"
              className="truncate text-sm font-medium tracking-tight"
            >
              {muted ? 'Muted' : label}
            </span>
            <span className="hidden truncate text-xs text-white/55 sm:inline">{agentLabel}</span>
          </div>
          <p data-testid="live-hud-caption" className="mt-0.5 truncate text-xs text-white/55">{caption}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-white/35">
            <LiveWaveformIcon className="h-3 w-3" active={!muted && callState !== 'error'} />
            Live with {agentLabel}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {typeof onCycleSpeed === 'function' && (
            <TtsSpeedButton speed={ttsSpeed} onCycle={onCycleSpeed} />
          )}
          {typeof onToggleSpeak === 'function' && (
            <button
              type="button"
              data-testid="hud-speak-button"
              onClick={onToggleSpeak}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                speakEnabled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-neutral-900'
              }`}
              aria-pressed={speakEnabled}
              aria-label={speakEnabled ? 'Voice replies on' : 'Voice replies off'}
              title={speakEnabled ? 'Voice replies on' : 'Voice replies off'}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            data-testid="hud-mute-button"
            onClick={onToggleMute}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
              muted ? 'bg-white text-neutral-900' : 'bg-white/15 text-white hover:bg-white/25'
            }`}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 5.25v13.5m-7.5-9.75H4.5v6h3.75L12 19.5V4.5L8.25 9zM19.5 9l-4.5 6" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
          {callState === 'error' && typeof onRetry === 'function' ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-10 items-center justify-center rounded-full bg-amber-400 px-3 text-xs font-semibold text-neutral-900"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const ctx = getLiveTraceContext()
              const qs = new URLSearchParams()
              if (ctx.callId) qs.set('call', ctx.callId)
              if (ctx.conversationId) qs.set('conversation', ctx.conversationId)
              window.open(`/live-trace${qs.toString() ? `?${qs}` : ''}`, '_blank', 'noopener')
            }}
            className="flex h-10 items-center justify-center rounded-full bg-white/10 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 hover:bg-white/20"
            aria-label="Open live trace"
            title="Open live trace"
          >
            Trace
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 hover:bg-white/90"
            aria-label="End Live"
            title="End Live"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
