import { useEffect, useMemo, useRef } from 'react'
import LiveWaveformIcon from './LiveWaveformIcon'
import { isTalkAckText, isGhostTranscript } from '../../hooks/useVoice'
import TtsSpeedButton from './TtsSpeedButton'

/**
 * MiniShizuhaChat — HIVE home inline chat (operator 2026-07-11).
 *
 * A rolling 2–3 message strip that lives directly under the "Ask Shizuha
 * anything..." input, so talking to Shizuha never leaves the home page (the
 * command-center dashboard and live theater stay visible below). The full
 * conversation remains one click away ("Open full chat").
 *
 * Renders from the SAME ConnectChat provider state as the full chat view:
 * the parent activates the Shizuha conversation without navigating and passes
 * `messages`/`typingUsers` down. No parallel message store, no double-send.
 */
export default function MiniShizuhaChat({
  messages,
  typingUsers,
  currentUserId,
  isLoading,
  agentLabel = 'Agent',
  onOpenFull,
  onClose,
  speakEnabled,
  onToggleSpeak,
  callState = 'idle',
  callError = null,
  onToggleCall,
  onRetryCall,
  onDismissCallError,
  ttsSpeed,
  onCycleSpeed,
}) {
  const scrollRef = useRef(null)
  // 'error' is a terminal guidance surface, not an active call (CON-296).
  const callActive = callState !== 'idle' && callState !== 'error'
  const callFailed = callState === 'error'
  const callLabel =
    callState === 'connecting' ? 'Connecting…'
      : callState === 'listening' ? 'Listening…'
        : callState === 'thinking' ? 'Thinking…'
          : callState === 'speaking' ? 'Speaking…'
            : ''

  // Rolling window: drop talk-seat "Replied." leftovers, keep recent turns.
  const visible = useMemo(() => {
    const list = Array.isArray(messages) ? messages : []
    return list.filter((m) => !isTalkAckText(m?.content) && !isGhostTranscript(m?.content)).slice(-20)
  }, [messages])

  const shizuhaTyping = Array.isArray(typingUsers) && typingUsers.length > 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible, shizuhaTyping])

  return (
    <div className="relative mt-2 rounded-2xl border border-gray-200/80 bg-white/85 shadow-lg shadow-brand-900/5 backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/70">
      {/* Header row: identity + controls */}
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        {callActive ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {callLabel || 'On call'}
          </span>
        ) : callFailed ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            Voice unavailable
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            {agentLabel} — live
          </span>
        )}
        <div className="flex items-center gap-1">
          {typeof onToggleCall === 'function' && (
            <button
              onClick={onToggleCall}
              title={
                callActive
                  ? 'End Live'
                  : callFailed
                    ? (callError?.canRetry ? 'Retry Live' : 'Dismiss voice error')
                    : 'Start Live voice'
              }
              aria-label={
                callActive
                  ? 'End Live'
                  : callFailed
                    ? (callError?.canRetry ? 'Retry Live' : 'Dismiss voice error')
                    : 'Start Live voice'
              }
              className={`rounded-lg p-1.5 transition-colors ${callActive
                ? 'text-white bg-neutral-900 dark:bg-white dark:text-neutral-900'
                : callFailed
                  ? 'text-white bg-amber-500'
                  : 'text-gray-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
            >
              <LiveWaveformIcon className="h-3.5 w-3.5" active={callActive} />
            </button>
          )}
          {typeof onCycleSpeed === 'function' && (
            <TtsSpeedButton speed={ttsSpeed} onCycle={onCycleSpeed} compact />
          )}
          {typeof onToggleSpeak === 'function' && (
            <button
              type="button"
              data-testid="mini-speak-button"
              onClick={onToggleSpeak}
              title={speakEnabled ? 'Hearing her — click to mute' : 'Her voice is muted — click to hear'}
              aria-pressed={speakEnabled}
              aria-label={speakEnabled ? 'Mute her voice' : 'Hear her voice'}
              className={`rounded-lg p-1.5 transition-colors ${speakEnabled}
                ? 'text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-950/40'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </button>
          )}
          <button
            onClick={onOpenFull}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-gray-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
            title="Open the full conversation"
          >
            Open full chat ↗
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            title="Hide mini chat"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* CON-296: voice-call failure guidance inside the mini-chat surface */}
      {callFailed && callError?.message && (
        <div
          role="alert"
          data-testid="voice-call-error"
          className="mx-3 mb-1 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <span className="flex-1 leading-relaxed">{callError.message}</span>
          {callError.canRetry && typeof onRetryCall === 'function' ? (
            <button
              type="button"
              onClick={onRetryCall}
              className="shrink-0 rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-amber-600"
            >
              Retry
            </button>
          ) : typeof onDismissCallError === 'function' ? (
            <button
              type="button"
              onClick={onDismissCallError}
              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800/80 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      )}

      {/* Rolling message window — capped height, newest pinned to bottom, a
          soft top fade sells the "rolling" read. */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-white/85 to-transparent dark:from-gray-900/70" />
        <div
          ref={scrollRef}
          data-testid="mini-chat-scroll"
          className="max-h-64 min-h-0 space-y-1.5 overflow-y-auto overscroll-y-contain px-4 pb-3 pt-1"
        >
          {isLoading && visible.length === 0 && (
            <p className="py-2 text-center text-xs text-gray-400">Loading conversation…</p>
          )}
          {visible.map((m) => {
            const mine = m.sender_id === currentUserId
            return (
              <div key={m.id || m.client_message_id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${mine
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}
                >
                  {!mine && (
                    <span className="mr-1 font-semibold text-brand-600 dark:text-brand-400">{m.sender_name || 'Shizuha'}:</span>
                  )}
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              </div>
            )
          })}
          {shizuhaTyping && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl bg-gray-100 px-3 py-2 dark:bg-gray-800">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
              </div>
            </div>
          )}
          {!isLoading && visible.length === 0 && !shizuhaTyping && (
            <p className="py-2 text-center text-xs text-gray-400">Say something — Shizuha replies right here.</p>
          )}
        </div>
      </div>
    </div>
  )
}
