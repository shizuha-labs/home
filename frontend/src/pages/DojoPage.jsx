import { useState } from 'react'
import { ArrowRight, Brain, CheckCircle, Code2, MessageSquare, Route, Sparkles, Target } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

const BENEFITS = [
  'AI interviewer for coding, system design, and behavioral rounds',
  'Structured rubric feedback and improvement plan per session',
  'Role-specific practice tracks (software, product, data, DevOps, and more)',
]

const PRACTICE_MODES = [
  {
    icon: Code2,
    title: 'Coding rounds',
    description: 'Practice algorithms, debugging, language depth, and explain-your-thinking prompts.',
  },
  {
    icon: Route,
    title: 'System design',
    description: 'Work through architecture trade-offs, APIs, data models, scaling, and reliability.',
  },
  {
    icon: MessageSquare,
    title: 'Behavioral prep',
    description: 'Turn your experience into crisp STAR stories with adaptive follow-up questions.',
  },
]

const TRACKS = ['Software', 'Product', 'Data', 'DevOps', 'Leadership']

function DojoWaitlistForm() {
  const [form, setForm] = useState({ name: '', email: '' })
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const submitWaitlist = async (payload) => {
    const res = await fetch('/api/forge/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.email) return

    setStatus('submitting')
    setErrorMsg('')

    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()

    try {
      const { res, data } = await submitWaitlist({
        name: `${name} (DOJO waitlist)`,
        email,
      })

      if (res.status === 201 || res.status === 200) {
        setStatus('success')
      } else {
        const msg = data?.email?.[0] || data?.detail || 'Something went wrong. Please try again.'
        setErrorMsg(msg)
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
        <CheckCircle className="mx-auto mb-4 h-14 w-14 text-emerald-500" />
        <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">You're on the DOJO waitlist!</h2>
        <p className="text-gray-600 dark:text-gray-300">
          We'll email you when early access opens. Get ready to practice with an AI interviewer built for real interview loops.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl shadow-indigo-500/10 dark:border-gray-800 dark:bg-gray-900 sm:p-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-indigo-600 dark:text-indigo-400">Early access</p>
        <h2 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">Join the waitlist</h2>
        <p className="mt-2 text-gray-500 dark:text-gray-400">Free tier on launch. Pro tier for ₹499/month.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={form.name}
            onChange={handleChange}
            placeholder="Your name"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>

        {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-lg font-semibold text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'submitting' ? 'Joining…' : 'Join Waitlist'}
          {status !== 'submitting' && <ArrowRight className="h-5 w-5" />}
        </button>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          No spam. We'll only email you about DOJO early access.
        </p>
      </div>
    </form>
  )
}

export default function DojoPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />

      <main className="flex-1 pt-16">
        <section className="relative overflow-hidden px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.16),_transparent_30%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                <Sparkles className="h-4 w-4" />
                DOJO — AI interview prep launching soon
              </div>

              <h1 className="max-w-4xl text-5xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white sm:text-6xl">
                Ace your next interview. AI-powered mock interviews for any role.
              </h1>

              <p className="mt-6 max-w-2xl text-xl leading-8 text-gray-600 dark:text-gray-300">
                Practice coding, system design, and behavioral interviews with AI feedback. Coming soon — join the waitlist.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                {TRACKS.map((track) => (
                  <span key={track} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    {track}
                  </span>
                ))}
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {PRACTICE_MODES.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="rounded-2xl border border-gray-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{description}</p>
                  </div>
                ))}
              </div>
            </div>

            <DojoWaitlistForm />
          </div>
        </section>

        <section className="px-4 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl rounded-3xl border border-gray-200 bg-gray-50 p-8 dark:border-gray-800 dark:bg-gray-900 sm:p-10">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
                <Brain className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-indigo-600 dark:text-indigo-400">What you get</p>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Practice loops that end with a plan</h2>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {BENEFITS.map((benefit) => (
                <div key={benefit} className="flex gap-3 rounded-2xl bg-white p-5 shadow-sm dark:bg-gray-800">
                  <Target className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-500" />
                  <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
