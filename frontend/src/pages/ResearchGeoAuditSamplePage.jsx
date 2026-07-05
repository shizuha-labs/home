import { useEffect } from 'react'
import { ArrowRight, CheckCircle2, ExternalLink, FileText, ShieldCheck } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const DISCLAIMER =
  'This is a research/advisory audit of AI-search and generative-engine visibility. It does not guarantee search rankings, AI-answer inclusion, citations, or any placement outcome. Results depend on third-party engines outside our control.'

const FINDINGS = [
  'AI answers describe the company from product-page language but miss the newest managed-agent positioning.',
  'Entity signals are split across landing pages, docs, and wiki reports; add a concise organization/profile page and consistent product names.',
  'Citation candidates exist, but pricing/scope pages need clearer crawlable copy and answer-ready summaries.',
]

const CHECKLIST = [
  'Publish a crawlable offer page with fixed scope, delivery window, and disclaimer copy.',
  'Add structured FAQ copy answering “what is included?”, “what is not guaranteed?”, and “how is evidence gathered?”.',
  'Create a short source-of-truth company/entity summary and link it from high-authority pages.',
]

export default function ResearchGeoAuditSamplePage() {
  useEffect(() => {
    setPageMeta({
      title: 'Sample GEO Audit Artifact — Shizuha Research',
      description: 'Sample AI-search/GEO visibility audit artifact showing visibility checks, entity/content gaps, citation-readiness fixes, and guardrail disclaimer copy.',
    })
    trackResearchEvent('research_sample_view', { offer: 'ai_search_visibility_audit', route: '/research/geo-audit-sample' })
  }, [])

  const trackClick = (name, payload = {}) => trackResearchEvent(name, { offer: 'ai_search_visibility_audit', ...payload })

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />

      <main className="flex-1 pt-16">
        <section className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-4xl mx-auto">
            <a
              href="/research"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 inline-block"
            >
              ← Back to Research
            </a>
            <div className="rounded-3xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/30 p-6 sm:p-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 text-sm font-medium mb-4 border border-violet-200 dark:border-violet-800">
                <FileText className="w-4 h-4" />
                Sample artifact · ₹0 demo
              </div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                Sample AI-search / GEO visibility audit
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
                This sample shows the shape of a paid fixed-scope 24–48h audit: visibility checks, content/entity gaps, citation-readiness fixes, and a prioritized remediation checklist. It is illustrative, not a live customer report.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="/research/order?offer=ai-search-audit&tier=audit"
                  onClick={() => trackClick('research_order_start', { source: 'sample_page', tier: 'audit' })}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-md shadow-violet-500/20"
                >
                  Submit paid-intent request
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="/research"
                  onClick={() => trackClick('research_offer_return', { source: 'sample_page' })}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300 font-semibold hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-colors"
                >
                  Compare audit tiers
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-4xl mx-auto grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Illustrative visibility findings</h2>
                <div className="space-y-3">
                  {FINDINGS.map((finding) => (
                    <div key={finding} className="flex gap-3 text-gray-600 dark:text-gray-300">
                      <CheckCircle2 className="w-5 h-5 text-violet-500 flex-shrink-0 mt-0.5" />
                      <p>{finding}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Prioritized remediation checklist</h2>
                <ol className="space-y-3 text-gray-600 dark:text-gray-300 list-decimal list-inside">
                  {CHECKLIST.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-5">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Paid audit scope</h2>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                  <li>• 24–48h fixed-scope advisory audit</li>
                  <li>• AI-answer visibility checks</li>
                  <li>• Entity and content gap summary</li>
                  <li>• Citation-readiness fixes</li>
                  <li>• Prioritized remediation checklist</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  <ShieldCheck className="w-4 h-4 text-violet-500" />
                  Disclaimer v2026-07-04
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{DISCLAIMER}</p>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
