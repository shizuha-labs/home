import LiveWaveformIcon from './LiveWaveformIcon'

/**
 * ChatGPT Live-style overlay: orb, Live label, mute + end.
 * Transcript stays in the same chat underneath; this is the voice surface.
 */
export default function LiveVoiceOverlay({
  agentLabel = 'Agent',
  callState = 'listening',
  muted = false,
  lastHeard = '',
  lastReply = '',
  error = null,
  onToggleMute,
  onEnd,
  onRetry,
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

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-between bg-neutral-950/92 px-6 py-10 text-white backdrop-blur-xl"
      data-testid="live-voice-overlay"
      role="dialog"
      aria-label="Live voice"
    >
      <div className="flex w-full max-w-md items-center justify-between pt-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Live
        </span>
        <span className="truncate text-sm text-white/70">{agentLabel}</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className={`relative transition-transform duration-500 ${orbScale}`}>
          <div className={`absolute -inset-10 rounded-full bg-gradient-to-br ${orbTone} opacity-40 blur-3xl`} />
          <div className={`relative h-44 w-44 rounded-full bg-gradient-to-br ${orbTone} shadow-[0_0_80px_rgba(129,140,248,0.45)]`}>
            <div className="absolute inset-[18%] rounded-full bg-neutral-950/70 backdrop-blur-sm" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-lg font-medium tracking-tight">{muted ? 'Muted' : label}</p>
          <p className="mt-2 max-w-sm text-sm text-white/55">
            {error
              || lastHeard
              || lastReply
              || 'Talk naturally — Hina hears you while she speaks.'}
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-sm items-center justify-center gap-6 pb-4">
        <button
          type="button"
          onClick={onToggleMute}
          className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
            muted ? 'bg-white text-neutral-900' : 'bg-white/15 text-white hover:bg-white/25'
          }`}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 5.25v13.5m-7.5-9.75H4.5v6h3.75L12 19.5V4.5L8.25 9zM19.5 9l-4.5 6" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
        {callState === 'error' && typeof onRetry === 'function' ? (
          <button
            type="button"
            onClick={onRetry}
            className="flex h-14 min-w-[3.5rem] items-center justify-center rounded-full bg-amber-400 px-4 text-sm font-semibold text-neutral-900"
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          onClick={onEnd}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-neutral-900 hover:bg-white/90"
          aria-label="End Live"
          title="End Live"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-white/40">
        <LiveWaveformIcon className="h-3.5 w-3.5" active={!muted && callState !== 'error'} />
        Live with {agentLabel}
      </p>
    </div>
  )
}
