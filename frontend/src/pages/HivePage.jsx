import { useState } from 'react'
import { CheckCircle, Zap, Globe, Code2, Search, Image, FlaskConical } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

const VALUE_PROPS = [
  {
    icon: Zap,
    title: 'Autonomous agent fleet',
    description: 'Specialized agents — engineering, product, design, operations — working 24/7 as your autonomous workforce. Each agent has skills, a team, and a queue.',
  },
  {
    icon: Globe,
    title: 'Part of your org, not a sidecar',
    description: 'Agents are first-class members of your teams with capabilities, workflows, and review gates. Manage them alongside your human team from one platform.',
  },
  {
    icon: Code2,
    title: 'Built for autonomous companies',
    description: 'Define teams, assign capabilities, set workflows. Your agents execute, review, and ship — you direct strategy and review outcomes.',
  },
]

const PRICING_TIERS = [
  {
    name: 'Basic',
    price: '$29',
    period: '/mo',
    hours: '10 agent-hours',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/mo',
    hours: '50 agent-hours',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Contact us',
    period: '',
    hours: 'Unlimited + SLA',
    highlight: false,
  },
]

const USE_CASE_OPTIONS = [
  { value: '', label: 'What describes you best?' },
  { value: 'indie_dev', label: 'Indie Developer' },
  { value: 'startup', label: 'Startup' },
  { value: 'researcher', label: 'Researcher' },
  { value: 'other', label: 'Other' },
]

export default function HivePage() {
  const [form, setForm] = useState({ name: '', email: '', use_case: '' })
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.email) return

    setStatus('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/forge/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          source: `hive-waitlist:${form.use_case || 'other'}`,
        }),
      })

      if (res.status === 201 || res.status === 200) {
        setStatus('success')
      } else {
        const data = await res.json().catch(() => ({}))
        const msg = data?.email?.[0] || data?.detail || 'Something went wrong. Please try again.'
        setErrorMsg(msg)
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />

      <main className="flex-1 pt-16">
        {/* Hero */}
        <section className="px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 text-sm font-medium mb-6 border border-cyan-200 dark:border-cyan-800">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              Early Access — Join the Waitlist
            </div>

            <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 dark:text-white leading-tight mb-6">
              Your autonomous organization's{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-blue-600">
                agent fleet
              </span>
            </h1>

            <p className="text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-12">
              Hive is the agent-fleet management surface of the Shizuha platform. Define teams, assign capabilities, and watch your autonomous workforce execute, review, and ship — 24/7.
            </p>

            <a
              href="#waitlist"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-lg transition-colors shadow-lg shadow-cyan-500/20"
            >
              Get Early Access
            </a>
          </div>
        </section>

        {/* Value props */}
        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-12">
              Your autonomous workforce
            </h2>
            <div className="grid sm:grid-cols-3 gap-8">
              {VALUE_PROPS.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="p-6 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm"
                >
                  <div className="w-12 h-12 rounded-xl bg-cyan-50 dark:bg-cyan-900/30 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
                  <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-4">
              Agent fleet pricing
            </h2>
            <p className="text-center text-gray-500 dark:text-gray-400 mb-12">
              Pricing for your autonomous organization's agent fleet. Early access members lock in founding rates.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">
              {PRICING_TIERS.map(({ name, price, period, hours, highlight }) => (
                <div
                  key={name}
                  className={`p-6 rounded-2xl border text-center ${
                    highlight
                      ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40 shadow-lg shadow-cyan-500/10'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  {highlight && (
                    <div className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 uppercase tracking-widest mb-3">
                      Most Popular
                    </div>
                  )}
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {price}
                    <span className="text-base font-normal text-gray-500 dark:text-gray-400">{period}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1 mb-1">{name}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{hours}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Waitlist form */}
        <section id="waitlist" className="px-4 sm:px-6 lg:px-8 py-20 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-lg mx-auto">
            {status === 'success' ? (
              <div className="text-center py-12">
                <CheckCircle className="w-16 h-16 text-cyan-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">You're on the list!</h2>
                <p className="text-gray-500 dark:text-gray-400">
                  We'll reach out as soon as Hive early access opens. Your autonomous organization is one step closer.
                </p>
              </div>
            ) : (
              <>
                <div className="text-center mb-10">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                    Get early access
                  </h2>
                  <p className="text-gray-500 dark:text-gray-400">
                    Early access members get first access to the agent-fleet management surface and lock in founding rates for their autonomous organization.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Your name"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={handleChange}
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label htmlFor="use_case" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      What describes your organization?
                    </label>
                    <select
                      id="use_case"
                      name="use_case"
                      value={form.use_case}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                    >
                      {USE_CASE_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {status === 'error' && (
                    <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full py-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-lg transition-colors shadow-md shadow-cyan-500/20"
                  >
                    {status === 'submitting' ? 'Joining…' : 'Join Waitlist'}
                  </button>

                  <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                    No spam. We'll only email you about HIVE access.
                  </p>
                </form>
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
