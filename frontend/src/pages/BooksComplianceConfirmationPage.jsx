import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BadgeCheck, LockKeyhole, ShieldCheck } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'

export default function BooksComplianceConfirmationPage() {
  const [state, setState] = useState('idle')
  const proof = useMemo(() => {
    const query = new URLSearchParams(window.location.search)
    return { challenge_id: query.get('id') || '', bearer: query.get('proof') || '' }
  }, [])

  useEffect(() => {
    setPageMeta({ title: 'Confirm Books Compliance request — Shizuha', description: 'Deliberately confirm a Books Compliance request. Opening this page alone changes nothing.' })
    const existing = document.querySelector('meta[name="referrer"]')
    const previous = existing?.getAttribute('content')
    const meta = existing || document.head.appendChild(document.createElement('meta'))
    meta.setAttribute('name', 'referrer')
    meta.setAttribute('content', 'no-referrer')
    return () => {
      if (!existing) meta.remove()
      else if (previous === null) existing.removeAttribute('content')
      else existing.setAttribute('content', previous)
    }
  }, [])

  const confirm = async () => {
    setState('submitting')
    try {
      const response = await fetch('/api/books/compliance/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
      })
      if (!response.ok) throw new Error('confirmation unavailable')
      setState('success')
    } catch {
      setState('error')
    }
  }

  const usable = proof.challenge_id && proof.bearer
  return (
    <div className="min-h-screen bg-[#050914] text-white selection:bg-cyan-300 selection:text-slate-950">
      <GlobalNavBar />
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center px-4 py-24 sm:px-6 lg:px-8">
        <section className="mx-auto w-full max-w-2xl rounded-[2rem] border border-cyan-300/20 bg-gradient-to-br from-cyan-300/10 via-slate-900 to-violet-400/10 p-7 shadow-2xl shadow-cyan-950/40 sm:p-10">
          {state === 'success' ? (
            <div className="text-center">
              <BadgeCheck className="mx-auto h-14 w-14 text-emerald-300" />
              <h1 className="mt-5 text-3xl font-semibold">Confirmation processed</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">If this proof was active, the contact channel is now confirmed for the request it was bound to. No account, payment, role or product access was created.</p>
            </div>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-300"><LockKeyhole /></div>
              <p className="mt-6 font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Deliberate channel proof</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Confirm this Books Compliance request.</h1>
              <p className="mt-4 text-sm leading-7 text-slate-300">Opening this page changes nothing. Continue only if you asked Shizuha to contact this channel about Books Compliance Cockpit access.</p>
              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-sm leading-6 text-slate-300">
                <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><span>The proof is single-use, expires after 60 minutes, and confirms only the immutable request and notice version it was issued for.</span></div>
              </div>
              {state === 'error' && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">This proof could not be processed. It may be expired or already used.</p>}
              {!usable && <p role="alert" className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">This confirmation link is incomplete. Request a fresh confirmation from the intake page.</p>}
              <button type="button" onClick={confirm} disabled={!usable || state === 'submitting'} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3.5 font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50">
                {state === 'submitting' ? 'Confirming…' : 'Confirm this request'} <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-4 text-center text-xs text-slate-500">No payment · no automatic access · software/workflow support only</p>
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  )
}
