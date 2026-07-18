import { useEffect, useState } from 'react'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'

const FALLBACK = {
  disclaimer: 'Validation pricing — subject to change. No payment is collected.',
  plans: [
    { id: 'demo', name: 'Free / Demo', price: '₹0', cadence: '', scope: 'One entity, current-period readiness and top gaps.' },
    { id: 'readiness', name: 'Readiness', price: '₹499', cadence: '/ month', scope: 'One entity, full checklist, calendar, gap alerts and export.' },
    { id: 'multi', name: 'Multi-entity', price: 'Coming soon', cadence: '', scope: 'Accountant workspace and multiple entities.' },
  ],
}
const features = [
  ['Current period readiness', true, true],
  ['Top gap categories', true, true],
  ['All-period checklist', false, true],
  ['Full due-date calendar', false, true],
  ['Evidence-linked export', 'Summary', 'Full'],
  ['Gap alerts', false, true],
]

export default function BooksCompliancePricingPage() {
  const [catalog, setCatalog] = useState(FALLBACK)
  useEffect(() => {
    setPageMeta({ title: 'Books Compliance Cockpit Pricing — validation only', description: '₹0 demo and ₹499/month validation hypothesis for Books Compliance readiness. Subject to change; request-access only, no payment.' })
    fetch('/api/books/compliance/catalog', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((data) => data && setCatalog(data)).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-[#050914] text-white selection:bg-cyan-300 selection:text-slate-950">
      <GlobalNavBar />
      <main className="pt-14">
        <section className="relative overflow-hidden px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.16),transparent_42%)]" />
          <div className="relative mx-auto max-w-4xl">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Pricing validation · no active plan</p>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.05em] sm:text-6xl">Start with readiness, <span className="text-cyan-300">not another filing promise.</span></h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">Compare the offer we are validating. Every action is request-access intent—never Buy, Subscribe or an entitlement grant.</p>
            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm text-amber-100"><ShieldCheck className="h-4 w-4" /> {catalog.disclaimer}</div>
          </div>
        </section>
        <section className="px-4 pb-20 sm:px-6 lg:px-8"><div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">{catalog.plans.map((plan) => <article key={plan.id} className={`relative flex flex-col rounded-[2rem] border p-7 ${plan.id === 'readiness' ? 'border-cyan-300/35 bg-cyan-300/[0.08] shadow-2xl shadow-cyan-950/40' : 'border-white/10 bg-white/[0.035]'}`}>{plan.id === 'readiness' && <span className="absolute -top-3 left-6 rounded-full bg-cyan-300 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-950">Validation hypothesis</span>}<h2 className="text-xl font-semibold">{plan.name}</h2><div className="mt-6"><span className="text-4xl font-semibold tracking-tight">{plan.price}</span><span className="ml-1 text-slate-400">{plan.cadence}</span></div><p className="mt-5 flex-1 text-sm leading-7 text-slate-400">{plan.scope}</p><a href="/books/compliance#request-access" className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 font-semibold text-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-300/15">Request access <ArrowRight className="h-4 w-4" /></a><p className="mt-3 text-center text-xs text-slate-500">No payment · no automatic access</p></article>)}</div></section>
        <section className="border-y border-white/5 bg-white/[0.02] px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl"><p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-300">Feature shape under validation</p><h2 className="mt-3 text-3xl font-semibold">One readiness layer. Deeper evidence when the workflow proves useful.</h2><div className="mt-8 overflow-hidden rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/[0.04] text-slate-300"><tr><th className="p-4 font-medium">Capability</th><th className="p-4 font-medium">Free / Demo</th><th className="p-4 font-medium">Readiness</th></tr></thead><tbody>{features.map(([name,demo,ready]) => <tr key={name} className="border-t border-white/10"><td className="p-4 text-slate-300">{name}</td>{[demo,ready].map((value,index) => <td key={index} className="p-4 text-slate-400">{value === true ? <Check className="h-4 w-4 text-emerald-300" /> : value === false ? '—' : value}</td>)}</tr>)}</tbody></table></div><div className="mt-8 flex flex-col items-start justify-between gap-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6 sm:flex-row sm:items-center"><div><h3 className="text-xl font-semibold">No credit card. No active subscription.</h3><p className="mt-2 text-sm text-slate-400">We will let you know when the validated tier is ready.</p></div><a href="/books/compliance#request-access" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950">Join request-access list <ArrowRight className="h-4 w-4" /></a></div></div></section>
        <section className="px-4 py-16 text-center text-sm leading-7 text-slate-400 sm:px-6"><p className="mx-auto max-w-3xl"><strong className="text-slate-200">Software/workflow support only—not tax or legal advice and not a filed return.</strong> Confirm current-year rules and thresholds with a qualified professional. Public examples are synthetic and contain no real identifiers, parties, documents or financial figures.</p></section>
      </main>
      <Footer />
    </div>
  )
}
