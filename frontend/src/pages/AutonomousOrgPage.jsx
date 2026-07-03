import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Briefcase, CheckCircle, ClipboardList, FileText, MessageSquare, ShieldCheck, Users, Workflow } from 'lucide-react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const PROVISIONED = [
  'Tenant organization with identity, roles, and workspace access.',
  'Pulse-style queues, blockers, WIP limits, review gates, verification, and status history.',
  'Wiki and Drive knowledge base seeded from your selected workflow and SOPs.',
  'Connect workspace for customer, agent, and human-sponsor communication.',
  'Managed agent roles with dashboards for activity, usage visibility, and support events.',
  'Weekly pilot review with a human sponsor path during the design-partner phase.',
]

const WORKFLOWS = [
  {
    icon: Workflow,
    title: 'Software / Product Delivery Pod',
    description: 'Backlog intake → spec → implementation → review → QA → release notes and docs.',
  },
  {
    icon: FileText,
    title: 'Content / Marketing Production Pod',
    description: 'Brief → research → draft → edit → distribution packet → performance notes.',
  },
  {
    icon: ClipboardList,
    title: 'Back-office / Ops Pod',
    description: 'Document intake → checklist execution → follow-ups → books or reporting packet.',
  },
]

const BEST_FIT = [
  'Founder-led SaaS or product teams with a real backlog and too little operational bandwidth.',
  'Small agencies or consultancies delivering repeatable client work.',
  'Content and marketing teams with recurring research → draft → review workflows.',
  'Ops-heavy service businesses with clear SOPs and a weekly sponsor.',
]

const NOT_FIT = [
  'Highly regulated workloads that require mature DPA or security posture before pilot review completes.',
  'Teams needing on-prem, customer-cloud deployment, BYO model marketplace, or large custom integrations on day one.',
  'Buyers expecting no-touch SaaS checkout or guaranteed business outcomes.',
]

const FAQS = [
  {
    q: 'Is this just a chatbot or agent builder?',
    a: 'No. The pilot is a managed tenant org: agents plus the coordination layer that makes them accountable — queues, review gates, wiki/runbooks, escalation, and support.',
  },
  {
    q: 'What is the first pilot package?',
    a: 'The default design-partner shape is a Team Pod: 3–5 agents around one primary workflow, manual onboarding, weekly review, and scoped usage.',
  },
  {
    q: 'Is pricing public?',
    a: 'Not yet. Design partners receive a scoped pilot quote after fit checks and unit-economics validation.',
  },
  {
    q: 'Can you promise enterprise isolation or compliance?',
    a: 'Not yet. Pilot eligibility depends on security and legal review. We avoid regulated or high-sensitivity workloads until the pilot gates are complete.',
  },
  {
    q: 'Can agents spend money, sign contracts, or make external commitments?',
    a: 'No autonomous external authority by default. Customer approval gates are required for spend, legal, account changes, and external commitments.',
  },
]

const SEGMENTS = [
  'Founder-led SaaS/product team',
  'Agency or consultancy',
  'Content/marketing team',
  'Ops-heavy services business',
  'Existing Shizuha warm contact',
  'Other',
]

function trackAutonomousOrg(event, payload = {}) {
  trackResearchEvent(event, { offer: 'autonomous_org_design_partner', route: '/autonomous-org', ...payload })
}

function sourceSummary(form) {
  const parts = [
    'autonomous-org-design-partner',
    `company=${form.company}`,
    `country=${form.country}`,
    `segment=${form.segment}`,
    `workflow=${form.workflow.slice(0, 120)}`,
    `sop=${form.sopLink.slice(0, 120)}`,
    `weeklySponsor=${form.weeklySponsor}`,
    `security=${form.securitySensitivity}`,
    `targetStart=${form.targetStartMonth}`,
  ]
  return parts.join('|').slice(0, 900)
}

function DesignPartnerForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    country: '',
    segment: '',
    workflow: '',
    sopLink: '',
    weeklySponsor: '',
    securitySensitivity: '',
    targetStartMonth: '',
  })
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const formStarted = useRef(false)

  function markStart() {
    if (formStarted.current) return
    formStarted.current = true
    trackAutonomousOrg('autonomous_org_form_start')
  }

  function updateField(e) {
    const { name, value } = e.target
    markStart()
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.email || !form.company || !form.country || !form.segment || !form.workflow || !form.weeklySponsor || !form.securitySensitivity || !form.targetStartMonth) return
    setStatus('submitting')
    setErrorMsg('')
    trackAutonomousOrg('autonomous_org_apply_submit', { segment: form.segment, security: form.securitySensitivity })

    try {
      const res = await fetch('/api/forge/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          source: sourceSummary(form),
        }),
      })

      if (res.status === 201 || res.status === 200) {
        setStatus('success')
        return
      }
      const data = await res.json().catch(() => ({}))
      setErrorMsg(data?.email?.[0] || data?.detail || 'Something went wrong. Please try again.')
      setStatus('error')
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-3xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-8 text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Application received</h3>
        <p className="text-gray-600 dark:text-gray-300">
          We will review fit, security sensitivity, and sponsor availability before proposing a scoped design-partner pilot. No payment is collected on this page.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-xl shadow-gray-200/40 dark:shadow-black/20 space-y-4">
      <div>
        <p className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 uppercase tracking-wide">Design-partner intake</p>
        <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">Apply with one recurring workflow</h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Manual onboarding only. We use this to route fit checks into Shizuha intake.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Name
          <input name="name" required value={form.name} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Work email
          <input name="email" type="email" required value={form.email} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Company
          <input name="company" required value={form.company} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Country
          <input name="country" required value={form.country} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Segment
        <select name="segment" required value={form.segment} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white">
          <option value="">Choose one</option>
          {SEGMENTS.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
        </select>
      </label>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Workflow to automate
        <textarea name="workflow" required rows={3} value={form.workflow} onChange={updateField} placeholder="Example: weekly release-note packet from shipped PRs, or research brief → draft → editor handoff" className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
      </label>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Current SOP/backlog link (optional)
        <input name="sopLink" value={form.sopLink} onChange={updateField} placeholder="URL or short note" className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
      </label>

      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Weekly sponsor?
          <select name="weeklySponsor" required value={form.weeklySponsor} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white">
            <option value="">Choose</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Security sensitivity
          <select name="securitySensitivity" required value={form.securitySensitivity} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white">
            <option value="">Choose</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Target start month
          <input name="targetStartMonth" type="month" required value={form.targetStartMonth} onChange={updateField} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-white" />
        </label>
      </div>

      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
      <button type="submit" disabled={status === 'submitting'} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-400 text-white font-semibold transition-colors shadow-lg shadow-cyan-500/20">
        {status === 'submitting' ? 'Submitting…' : 'Apply for a design-partner pilot'}
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  )
}

export default function AutonomousOrgPage() {
  useEffect(() => {
    setPageMeta({
      title: 'Shizuha Autonomous Org — managed AI workforce for startups',
      description: 'Shizuha provisions and operates a managed AI organization for your team: agents, workflows, knowledge, messaging, files, review gates, and human escalation.',
    })
    trackAutonomousOrg('autonomous_org_page_view')
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <Navbar />
      <main className="flex-1 pt-16">
        <section className="px-4 sm:px-6 lg:px-8 py-20 lg:py-28 overflow-hidden">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 text-sm font-medium mb-6 border border-cyan-200 dark:border-cyan-800">
                <Users className="w-4 h-4" />
                Design-partner pilots · manually onboarded
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
                Your startup&apos;s AI workforce, already operating.
              </h1>
              <p className="mt-6 text-xl text-gray-600 dark:text-gray-300 leading-relaxed max-w-2xl">
                Shizuha provisions and runs a managed autonomous org for your team — agents, workflows, knowledge, messaging, files, review gates, and escalation — based on the platform we use to run Shizuha itself.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href="#apply" onClick={() => trackAutonomousOrg('autonomous_org_apply_click', { source: 'hero' })} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors shadow-lg shadow-cyan-500/20">
                  Apply for a design-partner pilot
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a href="#internal-org" onClick={() => trackAutonomousOrg('autonomous_org_internal_demo_click')} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                  See how the internal org works
                </a>
              </div>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No self-serve checkout yet. Every pilot is scoped with your team before onboarding.</p>
            </div>

            <div id="internal-org" className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-5 sm:p-7 shadow-2xl shadow-gray-200/50 dark:shadow-black/30">
              <div className="rounded-2xl bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Shizuha internal org demo</div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">proof placeholder</span>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    ['Pulse queue', 'Spec → implement → review → merge → verify'],
                    ['Wiki memory', 'Runbooks, decisions, and reusable context'],
                    ['Connect escalation', 'Agents ask humans only at gated decisions'],
                    ['Usage visibility', 'Activity, support events, and scoped operations'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900">
                      <p className="font-semibold text-gray-900 dark:text-white">{title}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">We run ourselves on this operating model. Public metrics and tenant-isolation claims stay gated until approved.</p>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">What Shizuha provisions</h2>
              <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">A managed tenant org, not a blank agent canvas.</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {PROVISIONED.map((item) => (
                <div key={item} className="rounded-2xl bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-5 flex gap-3">
                  <CheckCircle className="w-5 h-5 text-cyan-500 flex-shrink-0 mt-0.5" />
                  <p className="text-gray-700 dark:text-gray-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Choose the first workflow</h2>
              <p className="mt-3 text-gray-600 dark:text-gray-300">The pilot starts with one recurring workflow and clear acceptance criteria.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {WORKFLOWS.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-950 flex items-center justify-center mb-5">
                    <Icon className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
                  <p className="mt-3 text-gray-600 dark:text-gray-300 leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-950 text-white">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-start">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-cyan-200 text-sm font-medium mb-5">
                <Briefcase className="w-4 h-4" />
                Operating system + managed agents
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold">Agent builders give you tools. Shizuha gives you an operating system plus managed agents.</h2>
              <p className="mt-5 text-gray-300 leading-relaxed">The difference is the management layer: queues, accountability, review, runbooks, escalation, and support — the same operating model Shizuha uses internally.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[['Queues', 'Work has owners, status, blockers, and review gates.'], ['Knowledge', 'Wiki and Drive keep reusable context out of chat history.'], ['Escalation', 'Human approval gates for spend, legal, account changes, and commitments.'], ['Support rhythm', 'A weekly sponsor review keeps the pilot scoped and measurable.']].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm text-gray-300">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8">
            <div className="rounded-3xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-5">Best fit</h2>
              <ul className="space-y-3">
                {BEST_FIT.map((item) => <li key={item} className="flex gap-3 text-gray-700 dark:text-gray-300"><CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />{item}</li>)}
              </ul>
            </div>
            <div className="rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-5">Not a fit yet</h2>
              <ul className="space-y-3">
                {NOT_FIT.map((item) => <li key={item} className="flex gap-3 text-gray-700 dark:text-gray-300"><ShieldCheck className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />{item}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section id="faq" className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-center text-gray-900 dark:text-white mb-10">FAQ</h2>
            <div className="space-y-4">
              {FAQS.map(({ q, a }) => (
                <div key={q} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{q}</h3>
                  <p className="mt-2 text-gray-600 dark:text-gray-300">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="apply" className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.85fr_1.15fr] gap-10 items-start">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 text-sm font-medium mb-5 border border-cyan-200 dark:border-cyan-800">
                <MessageSquare className="w-4 h-4" />
                Pilot CTA
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Bring one workflow with a weekly sponsor.</h2>
              <p className="mt-5 text-gray-600 dark:text-gray-300 leading-relaxed">We provision the workspace, template agents, review gates, and weekly pilot rhythm. You provide the sponsor, SOPs/source documents, and feedback.</p>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No paid ads, public prices, checkout, enterprise-isolation promises, GA SLA credits, or unlimited-usage claims on this pilot page.</p>
            </div>
            <DesignPartnerForm />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
