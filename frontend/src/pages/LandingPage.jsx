import { useEffect, useState } from 'react'
import { ArrowRight, Bot, Building2, Calendar, Check, Copy, Cpu, Download, GitBranch, LineChart, QrCode, Shield, Smartphone, Sparkles, Terminal, Users, Workflow } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import WelcomeBanner from '../components/WelcomeBanner'
import AppGrid from '../components/AppGrid'
import { useAuth } from '../contexts/AuthContext'
import androidApkQr from '../assets/android-apk-qr.svg'

const STEPS = [
  {
    icon: Building2,
    title: 'Define your organization',
    description: 'Set up teams, capabilities, and workflows. Your org structure — agents, roles, permissions, and knowledge — configured in minutes.',
  },
  {
    icon: Bot,
    title: 'Agents work 24/7',
    description: 'Your autonomous workforce builds, sells, supports, and decides. Queues flow, reviews happen, decisions are made — without a human in every loop.',
  },
  {
    icon: Users,
    title: 'You direct, not operate',
    description: 'Set goals, review outcomes, make strategic calls. The command center gives you a live picture of your org — agents, work, finances, alerts — at a glance.',
  },
]

const PROOF_POINTS = [
  {
    icon: GitBranch,
    title: 'Engineering pod',
    description: 'Our own engineering team runs on Shizuha — backlog intake, implementation, code review, QA, release notes. 40+ PRs shipped this week.',
    metric: '40+ PRs/wk',
  },
  {
    icon: LineChart,
    title: 'Trading operations',
    description: 'Autonomous trading agents monitor markets, execute strategies, and report P&L. Running 24/7 on our own infrastructure.',
    metric: '24/7 live',
  },
  {
    icon: Workflow,
    title: 'Product delivery',
    description: 'From spec to shipped feature — agents manage the full lifecycle: design, implementation, review, verification, documentation.',
    metric: 'End-to-end',
  },
]

const CAPABILITIES = [
  { icon: Cpu, title: 'Agent workforce', description: 'Autonomous agents with roles, skills, MCP tools, and team routing' },
  { icon: Shield, title: 'Org management', description: 'Multi-tenant platform with teams, roles, permissions, and audit' },
  { icon: GitBranch, title: 'Workflow engine', description: 'Queues, review gates, blockers, verification — your process, automated' },
  { icon: Sparkles, title: 'Command center', description: 'Live dashboard of your org — agents, work, finances, alerts' },
]

const INSTALL_COMMANDS = [
  {
    key: 'unix',
    label: 'macOS / Linux',
    command: 'curl -fsSL https://shizuha.com/install.sh | bash',
  },
  {
    key: 'windows',
    label: 'Windows (PowerShell)',
    command: 'irm https://shizuha.com/install.ps1 | iex',
  },
]

const ANDROID_RELEASE_ENDPOINT = '/builds/releases/android.json'
const ANDROID_RELEASES_URL = '/builds/releases'
const ANDROID_APK_URL = 'https://shizuha.com/builds/releases/shizuha-assistant-prod.apk'
const ANDROID_RELEASE_FALLBACK = {
  versionName: '1.1.1',
  versionCode: 237,
  built: '2026-07-05T01:20:05Z',
  url: ANDROID_APK_URL,
  size: 87065907,
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatBuildDate(value) {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value))
  } catch {
    return value.slice(0, 10)
  }
}

function AndroidDownloadCard() {
  const [release, setRelease] = useState(ANDROID_RELEASE_FALLBACK)

  useEffect(() => {
    let cancelled = false
    fetch(ANDROID_RELEASE_ENDPOINT, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const prod = data.variants?.prod || {}
        setRelease({
          versionName: data.versionName || ANDROID_RELEASE_FALLBACK.versionName,
          versionCode: data.versionCode || ANDROID_RELEASE_FALLBACK.versionCode,
          built: data.built || ANDROID_RELEASE_FALLBACK.built,
          url: prod.url || ANDROID_RELEASE_FALLBACK.url,
          size: prod.size || ANDROID_RELEASE_FALLBACK.size,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const buildDate = formatBuildDate(release.built)
  const size = formatBytes(release.size)

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/20 p-5 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-3">
            <Smartphone className="w-3.5 h-3.5" /> Android app
          </div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Download the Android APK</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 max-w-xl">
            Install the Shizuha mobile app on Android. Scan the QR code from your phone or use the direct download link.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 dark:bg-gray-900/70 px-3 py-1.5 ring-1 ring-emerald-200/70 dark:ring-emerald-900/70">
              <Check className="w-4 h-4 text-emerald-500" /> v{release.versionName} ({release.versionCode})
            </span>
            {buildDate && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 dark:bg-gray-900/70 px-3 py-1.5 ring-1 ring-emerald-200/70 dark:ring-emerald-900/70">
                <Calendar className="w-4 h-4 text-emerald-500" /> Built {buildDate} UTC
              </span>
            )}
            {size && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 dark:bg-gray-900/70 px-3 py-1.5 ring-1 ring-emerald-200/70 dark:ring-emerald-900/70">
                <Download className="w-4 h-4 text-emerald-500" /> {size}
              </span>
            )}
          </div>
          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <a
              href={release.url || ANDROID_APK_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              <Download className="w-4 h-4" /> Download APK
            </a>
            <a
              href={ANDROID_RELEASES_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 px-5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30 transition-colors"
            >
              View all builds <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl bg-white dark:bg-gray-950 p-4 ring-1 ring-emerald-200 dark:ring-emerald-900">
          <img src={androidApkQr} alt="QR code to download the Shizuha Android APK" className="w-32 h-32" />
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            <QrCode className="w-3.5 h-3.5" /> Scan to download
          </div>
        </div>
      </div>
    </div>
  )
}

function InstallCommand({ label, command }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable (http/permissions) — command stays selectable */ }
  }
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-950 px-4 py-3">
        <Terminal className="w-4 h-4 shrink-0 text-emerald-400" />
        <code className="flex-1 overflow-x-auto whitespace-nowrap text-sm text-gray-100 font-mono">{command}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label} install command`}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <GlobalNavBar />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden pt-24 pb-20 sm:pt-32 sm:pb-28">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/40 via-white to-white dark:from-brand-950/20 dark:via-gray-950 dark:to-gray-950" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-brand-200/30 to-transparent dark:from-brand-800/10 rounded-full blur-3xl" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-4 py-1.5 text-sm text-brand-700 dark:text-brand-300 mb-8">
                <Sparkles className="w-4 h-4" />
                Autonomous organizations — live and running
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 dark:text-white leading-[1.1]">
                Run your organization on{' '}
                <span className="text-brand-600 dark:text-brand-400">Shizuha</span>
              </h1>

              <p className="mt-6 text-lg sm:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
                Autonomous agents that build, sell, support, and decide — so you direct, not operate.
                Your teams, workflows, and knowledge, running 24/7 on your infrastructure.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="/autonomous-org"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200/50 dark:shadow-brand-900/30"
                >
                  Create your autonomous org
                  <ArrowRight className="w-5 h-5" />
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 px-8 py-3.5 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  How it works
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Authenticated apps ───────────────────────────────── */}
        {isAuthenticated && (
          <section className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-950">
            <div className="max-w-7xl mx-auto">
              <WelcomeBanner />
              <AppGrid />
            </div>
          </section>
        )}

        {/* ── How it works ─────────────────────────────────────── */}
        <section id="how-it-works" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
                From setup to autonomous operation
              </h2>
              <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                Your organization, running itself. Three steps from zero to autonomous.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {STEPS.map((step, i) => (
                <div key={step.title} className="relative">
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[60px] w-[calc(100%-60px)] h-px border-t-2 border-dashed border-brand-200 dark:border-brand-800" />
                  )}
                  <div className="flex flex-col items-center text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 mb-6 ring-1 ring-brand-200/50 dark:ring-brand-800/50">
                      <step.icon className="w-7 h-7" />
                    </div>
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold mb-3">
                      {i + 1}
                    </span>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">{step.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────── */}
        <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-gray-50/80 dark:bg-gray-900/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
                Everything an autonomous org needs
              </h2>
              <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                Not a chatbot. A platform where your organization lives and operates.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.title}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 hover:shadow-lg hover:shadow-brand-200/10 dark:hover:shadow-brand-900/10 transition-shadow"
                >
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 mb-4">
                    <cap.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{cap.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{cap.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Proof ────────────────────────────────────────────── */}
        <section id="proof" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
                Running our own orgs on Shizuha
              </h2>
              <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                We dogfood everything. These are live teams operating on the same platform we ship.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {PROOF_POINTS.map((point) => (
                <div
                  key={point.title}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 relative overflow-hidden"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
                      <point.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{point.title}</h3>
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{point.metric}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{point.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Install the CLI ──────────────────────────────────── */}
        <section id="install" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mx-auto">
              <div className="text-center mb-10">
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
                  Set up in one command
                </h2>
                <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
                  The Shizuha CLI runs your agents, TUI, and local daemon. One line installs a
                  self-contained binary — no system dependencies.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 space-y-6">
                {INSTALL_COMMANDS.map((c) => (
                  <InstallCommand key={c.key} label={c.label} command={c.command} />
                ))}
                <AndroidDownloadCard />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Then run <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-gray-700 dark:text-gray-200">shizuha</code> to
                  open the TUI, or <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-gray-700 dark:text-gray-200">shizuha up</code> to
                  start your agent daemon. Self-hosted — your data stays on your infrastructure.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-gray-50/80 dark:bg-gray-900/50">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                Ready to run your organization on Shizuha?
              </h2>
              <p className="text-lg text-gray-500 dark:text-gray-400 mb-10">
                Start with a guided setup or apply as a design partner. Either way, your autonomous org starts here.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="/autonomous-org"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200/50 dark:shadow-brand-900/30"
                >
                  Create your autonomous org
                  <ArrowRight className="w-5 h-5" />
                </a>
                <a
                  href="/autonomous-org"
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 px-8 py-3.5 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Apply as design partner
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
