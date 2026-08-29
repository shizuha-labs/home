import { formatTtsSpeed } from '../../hooks/useVoice'

/**
 * Cycle Grok TTS speed (0.7–1.5). Live replies are synthesized at this
 * rate so Fast actually shortens talk time, not just playback.
 */
export default function TtsSpeedButton({
  speed,
  onCycle,
  compact = false,
}) {
  const label = formatTtsSpeed(speed)
  return (
    <button
      type="button"
      data-testid="tts-speed-button"
      onClick={onCycle}
      aria-label={`Talk speed ${label}. Click to go faster.`}
      title={`Talk speed ${label}. Click to cycle 1× / 1.2× / 1.4×.`}
      className={compact
        ? 'rounded-lg px-1.5 py-1 text-[10px] font-semibold tabular-nums text-gray-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400'
        : 'flex h-10 min-w-[2.5rem] items-center justify-center rounded-full bg-white/15 px-2 text-[11px] font-semibold tabular-nums text-white hover:bg-white/25'}
    >
      {label}
    </button>
  )
}
