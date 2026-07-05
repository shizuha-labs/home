import { useEffect } from 'react'
import { ExternalLink, FileText, ArrowRight, SearchCheck, ShieldCheck, MousePointerClick, IndianRupee, Clock3 } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'
import { trackResearchEvent } from '../utils/analytics'

const AUDIT_DISCLAIMER =
  'This is a research/advisory audit of AI-search and generative-engine visibility. It does not guarantee search rankings, AI-answer inclusion, citations, or any placement outcome. Results depend on third-party engines outside our control.'

const AUDIT_TIERS = [
  {
    name: 'Sample / demo',
    price: '₹0',
    description: 'See the output shape before sharing an audit target.',
    href: '/geo-audit-sample.html',
    event: 'research_sample_click',
  },
  {
    name: 'AI-search visibility audit',
    price: '₹1,499',
    description: 'Fixed-scope 24–48h audit with visibility checks, entity/content gaps, and citation-readiness fixes.',
    href: '/research/order?offer=ai-search-audit&tier=audit',
    event: 'research_order_start',
  },
  {
    name: 'Audit + recheck',
    price: '₹2,499',
    description: 'The audit plus one follow-up recheck after you apply the remediation checklist.',
    href: '/research/order?offer=ai-search-audit&tier=audit-recheck',
    event: 'research_order_start',
  },
]

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
      description: 'Fixed-scope 24–48h AI-search/GEO visibility audit for ₹1,499, with a ₹0 sample and ₹2,499 audit-plus-recheck option. Intent only; no payment is collected.',
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
              AI-search visibility audit for founders and teams
            </h1>
            <p className="text-xl text-gray-500 dark:text-gray-400 mb-10">
              A fixed-scope 24–48h research/advisory audit of how AI answer engines understand your company, where entity and content gaps appear, and which citation-readiness fixes to prioritize.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="/research/order?offer=ai-search-audit&tier=audit"
                onClick={() => trackClick('research_order_start', { source: 'hero_cta', tier: 'audit' })}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-md shadow-violet-500/20"
              >
                Submit paid-intent request
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="/geo-audit-sample.html"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackClick('research_sample_click', { source: 'hero_cta' })}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300 font-semibold hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-colors"
              >
                View ₹0 sample audit
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* AI-search/GEO audit offer */}
        <section className="px-4 sm:px-6 lg:px-8 pb-14">
          <div className="max-w-5xl mx-auto rounded-3xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/30 p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 text-sm font-medium mb-4 border border-violet-200 dark:border-violet-800">
                  <SearchCheck className="w-4 h-4" />
                  AI-search / GEO audit · 24–48h fixed scope
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3">
                  Find out how AI answer engines describe your company.
                </h2>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-5">
                  We review visible public pages, answer-engine responses, entity signals, citation candidates, and gaps that may stop AI systems from understanding your positioning. The deliverable is an evidence-first audit, a prioritized remediation checklist, and citation-readiness fixes — not a promise of rankings, citations, or inclusion.
                </p>
                <div className="grid sm:grid-cols-3 gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <MousePointerClick className="w-5 h-5 text-violet-500 mb-2" />
                    Intent capture only — no payment collected on this site
                  </div>
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <Clock3 className="w-5 h-5 text-violet-500 mb-2" />
                    Fixed 24–48h scope: visibility checks, gaps, fixes
                  </div>
                  <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-violet-100 dark:border-violet-900">
                    <ShieldCheck className="w-5 h-5 text-violet-500 mb-2" />
                    No guaranteed SEO/GEO outcomes or AI placement
                  </div>
                </div>
              </div>
              <div className="lg:w-72 flex flex-col justify-center">
                <a
                  href="/research/order?offer=ai-search-audit&tier=audit"
                  onClick={() => trackClick('research_order_start', { source: 'audit_card', tier: 'audit' })}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-md shadow-violet-500/20"
                >
                  Submit paid-intent request
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="/geo-audit-sample.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackClick('research_sample_click', { source: 'audit_card' })}
                  className="mt-3 text-sm text-violet-700 dark:text-violet-300 hover:underline inline-flex items-center gap-1"
                >
                  View sample audit report <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mt-8">
              {AUDIT_TIERS.map((tier) => (
                <a
                  key={tier.name}
                  href={tier.href}
                  onClick={() => trackClick(tier.event, { source: 'tier_card', tier: tier.name })}
                  className="rounded-2xl bg-white dark:bg-gray-900 border border-violet-100 dark:border-violet-900 p-5 hover:border-violet-300 dark:hover:border-violet-600 transition-colors"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300 mb-2">
                    <IndianRupee className="w-4 h-4" />
                    {tier.name}
                  </div>
                  <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{tier.price}</div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{tier.description}</p>
                </a>
              ))}
            </div>

            <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Disclaimer v2026-07-04: {AUDIT_DISCLAIMER}
            </p>
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
            <h2 className="text-2xl font-bold mb-2">Ready to see the AI-search gaps for your company?</h2>
            <p className="text-violet-200 mb-6">
              ₹1,499 fixed-scope audit · ₹2,499 audit + recheck · 24–48h advisory deliverable · no payment collected here
            </p>
            <a
              href="/research/order?offer=ai-search-audit&tier=audit"
              onClick={() => trackClick('research_order_start', { source: 'bottom_cta', tier: 'audit' })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-violet-700 font-semibold hover:bg-violet-50 transition-colors shadow-md"
            >
              Submit paid-intent request
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
