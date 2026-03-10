import { ArrowRight, Terminal, Copy, Check, LayoutGrid, BookOpen, ChevronDown } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

// ── Platform install commands ────────────────────────────────────────

const PLATFORMS = [
  {
    id: 'macos',
    label: 'macOS',
    prompt: '$',
    cmd: 'curl -fsSL https://shizuha.com/install.sh | bash',
  },
  {
    id: 'linux',
    label: 'Linux',
    prompt: '$',
    cmd: 'curl -fsSL https://shizuha.com/install.sh | bash',
  },
  {
    id: 'windows',
    label: 'Windows',
    prompt: '>',
    cmd: 'irm https://shizuha.com/install.ps1 | iex',
  },
  {
    id: 'android',
    label: 'Android',
    prompt: '$',
    cmd: 'curl -fsSL https://shizuha.com/install.sh | bash',
    note: {
      title: 'Requires Termux',
      steps: [
        'Install F-Droid from f-droid.org',
        'Open F-Droid → search "Termux" → install',
        'Run: termux-change-repo (pick a fast mirror nearby)',
        'Run: pkg update && pkg install curl nodejs',
        'Then run the command above',
      ],
      warning: 'Do not use the Play Store version — it is outdated. Use F-Droid or GitHub releases.',
    },
  },
]

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'linux'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  return 'linux'
}

// ── Copy button ──────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for non-HTTPS contexts
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-white/10 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-400" />
      ) : (
        <Copy className="h-4 w-4 text-gray-400" />
      )}
    </button>
  )
}

// ── Platform-tabbed install box ──────────────────────────────────────

function InstallCommand() {
  const [active, setActive] = useState(() => detectPlatform())
  const platform = PLATFORMS.find((p) => p.id === active) ?? PLATFORMS[1]

  return (
    <div className="rounded-xl bg-gray-900 dark:bg-black border border-gray-700 dark:border-gray-800 overflow-hidden shadow-2xl">
      {/* Tab bar + traffic lights */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-gray-800 dark:bg-gray-900 border-b border-gray-700 dark:border-gray-800">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="hidden sm:flex gap-1.5 flex-shrink-0">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          {/* Platform tabs */}
          <div className="flex gap-0.5">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActive(p.id)}
                className={`px-2 sm:px-3 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors ${
                  active === p.id
                    ? 'bg-gray-700 dark:bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <CopyButton text={platform.cmd} />
      </div>
      {/* Command */}
      <div className="px-3 sm:px-4 py-4 font-mono text-xs sm:text-base text-left overflow-x-auto">
        <span className="text-green-400 whitespace-nowrap">{platform.prompt}</span>{' '}
        <span className="text-gray-300 whitespace-nowrap">{platform.cmd}</span>
      </div>
      {/* Platform-specific note */}
      {platform.note && (
        <div className="px-3 sm:px-4 pb-4 text-left border-t border-gray-800">
          <p className="text-xs font-semibold text-yellow-400 mt-3 mb-2">{platform.note.title}</p>
          <ol className="text-[11px] sm:text-xs text-gray-400 space-y-1 list-decimal list-inside">
            {platform.note.steps.map((step, i) => (
              <li key={i} className="leading-relaxed">{step}</li>
            ))}
          </ol>
          {platform.note.warning && (
            <p className="text-[11px] sm:text-xs text-red-400/80 mt-2 leading-relaxed">{platform.note.warning}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Quick start expandable ───────────────────────────────────────────

function QuickStartSteps() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="text-left">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <span className="font-medium">What does this do?</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-3 text-sm text-gray-500 dark:text-gray-400 space-y-1.5">
          <p>Downloads a self-contained binary (Node.js bundled), starts the daemon as a system service, and opens the dashboard at <span className="text-cyan-400 font-mono text-xs">localhost:8015</span>.</p>
          <p>Works on Linux (systemd), macOS (launchd), Docker, Termux, WSL, and more. No dependencies required.</p>
          <p className="text-gray-600 dark:text-gray-500 text-xs">Auto-starts on boot. Auto-restarts on crash. Run <span className="font-mono">shizuha down</span> to stop.</p>
        </div>
      )}
    </div>
  )
}

// ── Hero section ─────────────────────────────────────────────────────

export default function Hero() {
  const { isAuthenticated } = useAuth()

  return (
    <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 gradient-hero-light -z-10" />

      {/* Decorative elements */}
      <div className="absolute top-40 left-10 w-72 h-72 bg-brand-400/20 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl -z-10" />

      <div className="max-w-5xl mx-auto text-center">
        {/* Brand Name with Japanese */}
        <div className="mb-6 animate-fade-in flex items-center justify-center gap-4">
          <span className="text-5xl sm:text-6xl lg:text-7xl font-light text-brand-400 dark:text-brand-300 select-none">
            静葉
          </span>
          <span className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-800 dark:text-white">
            Shizuha
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6 animate-fade-in-up">
          AI agents for{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-purple-600 dark:from-brand-400 dark:to-purple-400">
            your entire stack.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-3xl mx-auto animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          Autonomous AI agents that work across 15+ integrated services — tasks, docs, email, code, finance, HR.
          One CLI. Full agentic workflows.
        </p>

        {/* Install command with platform tabs */}
        <div className="max-w-2xl mx-auto mb-4 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <InstallCommand />
        </div>

        {/* What does this do? */}
        <div className="max-w-2xl mx-auto mb-8 animate-fade-in-up" style={{ animationDelay: '180ms' }}>
          <QuickStartSteps />
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          {isAuthenticated ? (
            <a
              href="#apps"
              className="btn-primary btn-lg flex items-center gap-2 group"
            >
              <LayoutGrid className="h-5 w-5" />
              Open Apps
            </a>
          ) : (
            <a
              href="/id/register"
              className="btn-primary btn-lg flex items-center gap-2 group"
            >
              Get Started Free
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </a>
          )}
          <a
            href="/docs"
            className="btn-outline btn-lg flex items-center gap-2"
          >
            <BookOpen className="h-5 w-5" />
            Documentation
          </a>
        </div>

        {/* Trust indicator */}
        <p className="mt-8 text-sm text-gray-500 dark:text-gray-500 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          Self-hosted. Open MCP servers. Your data stays on your infrastructure.
        </p>
      </div>
    </section>
  )
}
