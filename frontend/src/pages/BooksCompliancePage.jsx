import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, BadgeCheck, BarChart3, CalendarClock, Check, FileCheck2, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'

const USE_CASES = [
  ['gst_tracking', 'GST readiness'],
  ['invoice_matching', 'Reconciliation'],
  ['report_auto', 'Report automation'],
  ['pan_verify', 'PAN workflow checks'],
]
const NOTICE_VERSION = 'books-compliance-notice-v23'
const FORM_STORAGE_KEY = 'books-compliance-funnel-v23'

function attribution() {
  const params = new URLSearchParams(window.location.search)
  const campaign = params.get('utm_source')?.toLowerCase()
  const allowed = new Set(['google', 'linkedin', 'twitter', 'facebook', 'instagram'])
  if (allowed.has(campaign)) return campaign
  try {
    const hostname = new URL(document.referrer).hostname.toLowerCase()
    for (const value of allowed) if (hostname === value + '.com' || hostname.endsWith('.' + value + '.com')) return value
  } catch { /* raw referrer never leaves this browser */ }
  return document.referrer ? 'other' : 'direct'
}

async function api(path, body) {
  const response = await fetch(`/api/books/compliance/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.detail?.message || data?.detail || 'Request unavailable')
  return data
}

function useComplianceFunnel(stage) {
  const [gate, setGate] = useState({ loading: true, enabled: false })
  const [token, setToken] = useState(() => typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem(FORM_STORAGE_KEY) || '')

  useEffect(() => {
    let active = true
    fetch('/api/books/compliance/health', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then(async (health) => {
        if (!active) return
        const enabled = Boolean(health?.intake_enabled)
        setGate({ loading: false, enabled })
        if (!enabled) return
        let current = token
        if (!current) {
          const issued = await api('token', {})
          current = issued.token
          sessionStorage.setItem(FORM_STORAGE_KEY, current)
          setToken(current)
        }
        await api('beacon', { token: current, event: stage, source: attribution(), referrer: attribution() })
      })
      .catch(() => active && setGate({ loading: false, enabled: false }))
    return () => { active = false }
  }, [stage, token])

  return { gate, token, clear: () => { sessionStorage.removeItem(FORM_STORAGE_KEY); setToken('') } }
}

function SyntheticCockpit() {
  const tones = { emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' }
  return (
    <div className="relative rounded-[2rem] border border-cyan-300/20 bg-slate-950/90 p-4 sm:p-5 shadow-2xl shadow-cyan-950/50 ring-1 ring-white/5">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300">Synthetic preview</p>
          <p className="mt-1 text-sm font-semibold text-white">Northstar Components · Demo</p>
        </div>
        <span className="rounded-full bg-emerald-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Read only</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[['Ready', '06', 'emerald'], ['Review', '03', 'amber'], ['Blocked', '01', 'rose']].map(([label, value, color]) => (
          <div key={label} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="truncate text-[11px] text-slate-400">{label}</p>
            <p className={`mt-2 text-2xl font-semibold ${tones[color]}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {[
          ['GSTR-2B source check', 'Ready', true],
          ['Supplier filing signals', 'Review', false],
          ['Period ownership', 'Ready', true],
        ].map(([label, status, ok]) => (
          <div key={label} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-xs">
            <span className="min-w-0 truncate text-slate-300">{label}</span>
            <span className={ok ? 'text-emerald-300' : 'text-amber-300'}>{status}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">No real identifiers, parties, documents or financial figures</p>
    </div>
  )
}

function IntakePanel({ funnel }) {
  const [form, setForm] = useState({ name: '', email: '', company: '', phone: '', use_cases: [], org_size: '1-10', consent: false })
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const enabled = funnel.gate.enabled

  const toggleUseCase = (value) => setForm((current) => ({
    ...current,
    use_cases: current.use_cases.includes(value)
      ? current.use_cases.filter((item) => item !== value)
      : current.use_cases.length < 3 ? [...current.use_cases, value] : current.use_cases,
  }))

  const submit = async (event) => {
    event.preventDefault()
    setState('submitting')
    setError('')
    try {
      const clientNonce = crypto.getRandomValues(new Uint32Array(4)).join('-')
      const result = await api('intake', {
        token: funnel.token,
        client_nonce: clientNonce,
        name: form.name,
        email: form.email,
        company: form.company,
        phone: form.phone || null,
        use_cases: form.use_cases,
        org_size: form.org_size,
        consent: form.consent,
        source: attribution(),
      })
      if (result.status === 'terminal') throw new Error(result.message)
      funnel.clear()
      setState('success')
    } catch (reason) {
      setError(reason.message || 'Your details were not saved. Please try again.')
      setState('error')
    }
  }

  if (!enabled) {
    return (
      <div id="request-access" className="rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-slate-900 to-violet-400/10 p-7 sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300"><LockKeyhole /></div>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Private validation · intake closed</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">We are proving the workflow before collecting contact details.</h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">The public request form is deliberately off while the privacy and confirmation controls complete their launch gate. You can still review the offer and validation pricing—no information is collected on this page.</p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200"><ShieldCheck className="h-4 w-4" /> Zero public lead or provider writes</div>
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div id="request-access" className="rounded-[2rem] border border-emerald-400/25 bg-emerald-400/10 p-8 text-center">
        <BadgeCheck className="mx-auto h-14 w-14 text-emerald-300" />
        <h2 className="mt-5 text-3xl font-semibold text-white">Request received</h2>
        <p className="mx-auto mt-3 max-w-lg text-slate-300">Please check your email to confirm. We will reach out only after you verify the channel. No account, payment, role or product access was created.</p>
      </div>
    )
  }

  return (
    <form id="request-access" onSubmit={submit} className="rounded-[2rem] border border-cyan-400/20 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/30 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Request access · no payment</p>
      <h2 className="mt-3 text-3xl font-semibold text-white">Tell us where to send the confirmation.</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">Bounded contact metadata only. Never submit PAN, TAN, GSTIN, financial figures, invoices or documents.</p>
      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        {[['name','Full name','text',100],['email','Email address','email',254],['company','Company','text',200],['phone','Phone · optional','tel',20]].map(([name,label,type,maxLength]) => (
          <label key={name} className={name === 'company' ? 'sm:col-span-2' : ''}>
            <span className="text-sm font-medium text-slate-200">{label}</span>
            <input name={name} type={type} required={name !== 'phone'} maxLength={maxLength} value={form[name]} onChange={(e) => setForm({...form,[name]:e.target.value})} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25" />
          </label>
        ))}
      </div>
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-slate-200">What should the cockpit help with? <span className="text-slate-500">Choose up to 3</span></legend>
        <div className="mt-3 flex flex-wrap gap-2">{USE_CASES.map(([value,label]) => <button type="button" key={value} aria-pressed={form.use_cases.includes(value)} onClick={() => toggleUseCase(value)} className={`rounded-full border px-3 py-2 text-sm transition ${form.use_cases.includes(value) ? 'border-cyan-300 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-slate-400 hover:border-white/25'}`}>{label}</button>)}</div>
      </fieldset>
      <label className="mt-6 block">
        <span className="text-sm font-medium text-slate-200">Organization size</span>
        <select value={form.org_size} onChange={(e) => setForm({...form,org_size:e.target.value})} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25">
          {['1-10','11-50','51-200','201-1000','1000+'].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
        <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({...form,consent:e.target.checked})} className="mt-1 h-4 w-4 accent-cyan-400" />
        <span>By ticking this box, you ask Shizuha to send a confirmation message about Books Compliance Cockpit access. Contact is permitted only after you confirm the channel. You may withdraw or request access/erasure via privacy@shizuha.com. Notice {NOTICE_VERSION}. <a className="text-cyan-300 underline" href="/privacy">Privacy policy</a>.</span>
      </label>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
      <button disabled={state === 'submitting' || !funnel.token} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3.5 font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50">{state === 'submitting' ? 'Sending request…' : 'Send confirmation request'} <ArrowRight className="h-4 w-4" /></button>
    </form>
  )
}

export default function BooksCompliancePage() {
  const funnel = useComplianceFunnel('landing_view')
  useEffect(() => setPageMeta({ title: 'Books Compliance Cockpit — GST readiness workflow', description: 'India-hosted Books compliance readiness for GST tracking, reconciliation, evidence and reports. Request-access validation only; no payment or tax advice.' }), [])
  const proof = useMemo(() => [
    [FileCheck2, 'Built on Books data', 'Readiness signals from the records already inside your governed Books workspace—no public uploads.'],
    [BarChart3, 'Gaps, not guesses', 'See bounded checklist states, reconciliation categories and evidence references before filing work begins.'],
    [CalendarClock, 'Current-rule caution', 'Dates and thresholds are workflow aids. Confirm current GSTN/CBIC rules with your qualified professional.'],
  ], [])

  return (
    <div className="min-h-screen bg-[#050914] text-white selection:bg-cyan-300 selection:text-slate-950">
      <GlobalNavBar />
      <main className="overflow-hidden pt-14">
        <section className="relative border-b border-white/5 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.13),transparent_32%),radial-gradient(circle_at_80%_30%,rgba(139,92,246,0.12),transparent_30%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-cyan-200"><Sparkles className="h-4 w-4" /> Books · Compliance cockpit</div>
              <h1 className="mt-7 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl">See compliance readiness <span className="text-cyan-300">before filing week.</span></h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">An India-hosted, read-only cockpit for GST/TDS/TCS workflow readiness—check gaps, source signals and due-date ownership from your Books data without turning software into tax advice.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="#request-access" className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200">Request access <ArrowRight className="h-4 w-4" /></a>
                <a href="/books/compliance/pricing" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 font-semibold text-white transition hover:border-white/30 hover:bg-white/5">View validation pricing</a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">{['India hosted', 'No public financial data', 'No filing or advice claims'].map((item) => <span key={item} className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-emerald-300" />{item}</span>)}</div>
            </div>
            <SyntheticCockpit />
          </div>
        </section>

        <section id="capabilities" className="px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl"><p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">Readiness layer · not a filing tool</p><h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Turn scattered pre-filing checks into one explainable workflow.</h2><div className="mt-10 grid gap-4 md:grid-cols-3">{proof.map(([Icon,title,copy]) => <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-1 hover:border-cyan-300/20"><Icon className="h-6 w-6 text-cyan-300" /><h3 className="mt-6 text-xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-400">{copy}</p></article>)}</div></div></section>

        <section id="how-it-works" className="border-y border-white/5 bg-white/[0.02] px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl"><div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]"><div><p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-300">Three-step operating loop</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Connect. Review. Act with evidence.</h2><p className="mt-4 text-slate-400">The cockpit organizes workflow signals; your accountant or qualified professional owns filing decisions.</p></div><ol className="grid gap-4 sm:grid-cols-3">{[['01','Connect Books','Use your existing governed entity—no public upload path.'],['02','See readiness','Review checklist states, anomaly categories and upcoming ownership.'],['03','Export & act','Share an evidence-linked snapshot with your accountant.']].map(([n,title,copy]) => <li key={n} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5"><span className="font-mono text-sm text-violet-300">{n}</span><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p></li>)}</ol></div></div></section>

        <section className="px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.8fr_1.2fr]"><div><p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">Privacy by launch gate</p><h2 className="mt-3 text-3xl font-semibold">Intent first. Verification before contact.</h2><div className="mt-6 space-y-4 text-sm leading-7 text-slate-400"><p>Submitting creates no account, role, token, entitlement, payment or product access.</p><p>Anonymous requests remain immutable and unverified until deliberate channel possession is proven.</p><p>No Plausible or other third-party analytics loads on these Books Compliance surfaces.</p></div><div className="mt-8 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-5"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><p className="text-sm leading-6 text-amber-100/80"><strong className="text-amber-100">Software/workflow support only.</strong> Not tax or legal advice and not a filed return. Confirm current-year rules and thresholds against government notifications with a qualified professional.</p></div></div></div><IntakePanel funnel={funnel} /></div></section>
      </main>
      <Footer />
    </div>
  )
}
