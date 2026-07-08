import { useEffect } from 'react'
import { Check, Image, Zap, BarChart3, Shield, Code2, ArrowRight } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    sub: 'No commitment required',
    icon: Image,
    features: [
      '10 images/day',
      'Standard quality',
      'REST API access',
      'Community support',
      'Rate limit: 1 req/s',
    ],
    cta: 'Get API Key',
    href: '/forge/signup',
  },
  {
    name: 'Pay-as-you-go',
    price: '$0.02',
    sub: '/image, GST invoicing available',
    icon: Zap,
    highlight: true,
    features: [
      'Unlimited images/day',
      'HD quality output',
      'Priority API routing',
      'Rate limit: 10 req/s',
      'Usage dashboard',
      'Email support',
    ],
    cta: 'Get API Key',
    href: '/forge/signup',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    sub: 'Tailored to your needs',
    icon: BarChart3,
    features: [
      'Custom rate limits',
      'Dedicated throughput',
      'Custom model fine-tuning',
      'SSO & team management',
      'SLA guarantee',
      '24/7 dedicated support',
    ],
    cta: 'Contact us',
    href: 'mailto:sales@shizuha.com',
  },
]

const FEATURES = [
  { icon: Zap, title: 'Fast inference', desc: 'GPU-accelerated image generation with sub-second latency for standard outputs.' },
  { icon: Shield, title: 'Enterprise security', desc: 'AES-256 encryption at rest, TLS in transit. Your data stays yours.' },
  { icon: Code2, title: 'Developer-friendly API', desc: 'Simple REST API with SDKs for Python, TypeScript, and cURL. Get started in minutes.' },
  { icon: BarChart3, title: 'Usage analytics', desc: 'Track your usage, spending, and generation history in real-time from the dashboard.' },
]

export default function ForgePricingPage() {
  useEffect(() => {
    setPageMeta({
      title: 'Forge API Pricing — Shizuha',
      description: 'Simple, transparent pricing for Shizuha Forge. Free tier: 10 images/day. Paid: $0.02/image overage. Enterprise: custom pricing.',
    })
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <GlobalNavBar />

      {/* Hero */}
      <section className="pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-sm font-medium mb-6">
            <Image className="w-4 h-4" />
            Shizuha Forge
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white tracking-tight">
            Simple pricing for image generation
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Start with 10 free images per day. Scale with pay-as-you-go pricing
            at $0.02 per image. No monthly commitments.
          </p>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8" id="pricing">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {TIERS.map((tier) => {
              const Icon = tier.icon
              return (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl border p-6 flex flex-col ${
                    tier.highlight
                      ? 'border-purple-600 bg-purple-50/50 dark:bg-purple-900/10 dark:border-purple-500 ring-2 ring-purple-500/20'
                      : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                  }`}
                >
                  {tier.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="text-xs font-semibold bg-purple-600 text-white px-3 py-1 rounded-full">
                        Most popular
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      tier.highlight
                        ? 'bg-purple-600'
                        : 'bg-gray-100 dark:bg-gray-800'
                    }`}>
                      <Icon className={`w-5 h-5 ${
                        tier.highlight ? 'text-white' : 'text-gray-600 dark:text-gray-300'
                      }`} />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {tier.name}
                    </h3>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    {tier.price}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {tier.sub}
                  </p>
                  <ul className="mt-6 space-y-3 flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Check className={`w-4 h-4 mt-0.5 shrink-0 ${
                          tier.highlight ? 'text-purple-600' : 'text-gray-400'
                        }`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={tier.href}
                    className={`mt-6 block w-full text-center rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                      tier.highlight
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white'
                    }`}
                  >
                    {tier.cta}
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-12">
            Why Shizuha Forge?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {FEATURES.map((feat) => {
              const Icon = feat.icon
              return (
                <div key={feat.title} className="flex gap-4 p-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{feat.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{feat.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* FAQ / CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Ready to start building?
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Get your free API key and start generating images in minutes.
            No credit card required.
          </p>
          <a
            href="/forge/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 text-sm font-semibold transition-colors"
          >
            Get API Key
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      <Footer />
    </div>
  )
}
