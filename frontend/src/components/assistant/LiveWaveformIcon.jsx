/**
 * ChatGPT Live-style waveform (four vertical bars).
 * Used as the only voice-call affordance on home — not a phone handset.
 */
export default function LiveWaveformIcon({ className = 'h-4 w-4', active = false }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y={active ? 6 : 8} width="3" height={active ? 12 : 8} rx="1.5">
        {active && (
          <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" />
        )}
        {active && (
          <animate attributeName="y" values="8;5;8" dur="0.9s" repeatCount="indefinite" />
        )}
      </rect>
      <rect x="9" y={active ? 3 : 5} width="3" height={active ? 18 : 14} rx="1.5">
        {active && (
          <animate attributeName="height" values="14;18;10;14" dur="0.7s" repeatCount="indefinite" />
        )}
        {active && (
          <animate attributeName="y" values="5;3;7;5" dur="0.7s" repeatCount="indefinite" />
        )}
      </rect>
      <rect x="14" y={active ? 5 : 7} width="3" height={active ? 14 : 10} rx="1.5">
        {active && (
          <animate attributeName="height" values="10;16;8;10" dur="0.8s" repeatCount="indefinite" />
        )}
        {active && (
          <animate attributeName="y" values="7;4;8;7" dur="0.8s" repeatCount="indefinite" />
        )}
      </rect>
      <rect x="19" y={active ? 8 : 9} width="3" height={active ? 8 : 6} rx="1.5">
        {active && (
          <animate attributeName="height" values="6;12;6" dur="1s" repeatCount="indefinite" />
        )}
        {active && (
          <animate attributeName="y" values="9;6;9" dur="1s" repeatCount="indefinite" />
        )}
      </rect>
    </svg>
  )
}
