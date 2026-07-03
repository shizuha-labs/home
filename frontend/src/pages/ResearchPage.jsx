import { useEffect } from 'react'
import { ExternalLink, FileText, ArrowRight, SearchCheck, ShieldCheck, MousePointerClick } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const REPORTS = [
  {
    title: 'The State of AI Agents in 2026',
    summary:
      'Autonomous AI agents — their architecture, reliability limits, capability growth trajectory, and the MCP interoperability standard — synthesized from 30 sources with adversarial 3-vote verification. 5 confirmed findings, 19 claims refuted.',
    tags: ['AI Agents', 'MCP', 'Reliability', 'Enterprise'],
    wikiPath: '/wiki/the-state-of-ai-agents-in-2026-research-report',
  },
  {
    title: 'Top Emerging AI & Developer Tools in 2026',
    summary:
      'Cursor ($500M ARR), Claude Code ($2.5B+ ARR), Devin 2.0 price collapse, Microsoft Agent Framework GA, and the LLM observability market (Braintrust, Arize). 7 verified findings from 31 sources.',
    tags: ['Developer Tools', 'AI IDEs', 'Observability', 'Frameworks'],
    wikiPath: '/wiki/research-report-top-10-emerging-developer-tools-in-2026',
  },
  {
    title: "India's AI Startup Landscape 2026",
    summary:
      "IndiaAI Mission ($1.25B sanctioned, $48M deployed), 34K+ GPUs live, four foundation model companies selected (Sarvam, Soket, Gnani, Gan), $643M in 2025 AI startup funding, General Catalyst's $5B India pledge.",
    tags: ['India', 'AI Investment', 'Foundation Models', 'Government Policy'],
    wikiPath: '/wiki/research-report-indias-ai-startup-landscape-2026',
  },
]

export default function ResearchPage() {
  useEffect(() => {
    setPageMeta({
      title: 'AI Search Visibility Audit — Shizuha Research',
      description: 'Draft Research-as-a-Service offer: audit how an organization appears in AI search and answer engines, with evidence-based recommendations and no ranking guarantees.',
    })
    trackResearchEvent('research_offer_view', { offer: 'ai_search_visibility_audit', route: '/research' })
  }, [])

  const trackClick = (name, payload = {}) => trackResearchEvent(name, { offer: 'ai_search_visibility_audit', ...payload })

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />

      <main className="flex-1 pt-16">
        {/* Hero */}
        <section className="px-4 sm:px-6 lg:px-8 py-20 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-sm font-medium mb-6 border border-violet-200 dark:border-violet-800">
              <FileText className="w-4 h-4" />
              Shizuha Research
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              AI Research Reports
            </h1>
            <p className="text-xl text-gray-500 dark:text-gray-400 mb-10">
              Free sample reports produced by Shizuha's multi-agent deep-research harness — adversarially verified, vendor-claim-free.
            </p>

            <a
              href="/research/order?offer=ai-search-audit"
              onClick={() => trackClick('research_order_start', { source: 'hero_cta' })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-md shadow-violet-500/20"
            >
              Request an AI-search audit
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>


        {/* AI-search/GEO audit offer */}
        <section className="px-4 sm:px-6 lg:px-8 pb-14">
          <div className="max-w-4xl mx-auto rounded-3xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/30 p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 text-sm font-medium mb-4 border border-violet-200 dark:border-violet-800">
                  <SearchCheck className="w-4 h-4" />
                  Draft offer · AI-search / GEO audit
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3">
                  Find out how AI answer engines describe your company.
                </h2>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-5">
                  We review visible public pages, answer-engine snippets, citation candidates, and gaps that may stop AI systems from understanding your positioning. The output is an evidence-first audit and prioritized content fixes — not a promise of rankings, citations, or inclusion.
                </p>
                <div className="grid sm:grid-cols-3 gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <MousePointerClick className="w-5 h-5 text-violet-500 mb-2" />
                    Intent capture only — no payment now
                  </div>
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <FileText className="w-5 h-5 text-violet-500 mb-2" />
                    Sample audit scope + gap list
                  </div>
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <ShieldCheck className="w-5 h-5 text-violet-500 mb-2" />
                    No guaranteed SEO/GEO outcomes
                  </div>
                </div>
              </div>
              <div className="lg:w-64 flex flex-col justify-center">
                <a
                  href="/research/order?offer=ai-search-audit"
                  onClick={() => trackClick('research_order_start', { source: 'audit_card' })}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-md shadow-violet-500/20"
                >
                  Start audit request
                  <ArrowRight className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => trackClick('research_sample_click', { source: 'audit_card' })}
                  className="mt-3 text-sm text-violet-700 dark:text-violet-300 hover:underline"
                >
                  Track sample audit interest
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Report listing */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-4xl mx-auto space-y-6">
            {REPORTS.map(({ title, summary, tags, wikiPath }) => (
              <div
                key={title}
                className="p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-violet-300 dark:hover:border-violet-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-4">{summary}</p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <a
                    href={wikiPath}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Read
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Order CTA banner */}
        <section className="px-4 sm:px-6 lg:px-8 pb-24">
          <div className="max-w-4xl mx-auto rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-8 text-center text-white">
            <h2 className="text-2xl font-bold mb-2">Need a custom report on your industry or topic?</h2>
            <p className="text-violet-200 mb-6">
              $49 · 24-hour delivery · Adversarially verified, no marketing fluff
            </p>
            <a
              href="/research/order"
              onClick={() => trackClick('research_order_start', { source: 'bottom_cta', offer: 'custom_report' })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-violet-700 font-semibold hover:bg-violet-50 transition-colors shadow-md"
            >
              Order a Custom Report
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
