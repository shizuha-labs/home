import { useEffect } from 'react'
import { Check, HardDrive, ArrowRight, Cloud, Users, Building2 } from 'lucide-react'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'
import { setPageMeta } from '../utils/pageMeta'

const TIERS = [
  {
    name: 'Free',
    price: '₹0',
    sub: 'For personal use',
    icon: Cloud,
    features: [
      '5 GB storage',
      'Basic Drive features',
    ],
    cta: 'Join waitlist',
    href: '/drive/waitlist',
  },
  {
    name: 'Pro',
    price: '₹299',
    sub: '/month',
    icon: HardDrive,
    highlight: true,
    features: [
      '50 GB storage',
      'GST-compliant billing',
    ],
    cta: 'Join waitlist',
    href: '/drive/waitlist',
  },
  {
    name: 'Team',
    price: '₹799',
    sub: '/month',
    icon: Users,
    features: [
      '200 GB shared storage',
      'Team sharing',
      'Agent integration',
      'GST-compliant billing',
    ],
    cta: 'Join waitlist',
    href: '/drive/waitlist',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    sub: 'Tailored to your org',
    icon: Building2,
    features: [
      'Custom storage',
      'Custom pricing',
      'Service-level agreement (SLA)',
      'Dedicated support',
    ],
    cta: 'Contact us',
    href: 'mailto:sales@shizuha.com',
  },
]

export default function DrivePricingPage() {
  useEffect(() => {
    setPageMeta({
      title: 'Drive Pricing — Shizuha',
      description: 'Simple, transparent pricing for Shizuha Drive. Free tier available. Pro at ₹299/mo, Team at ₹799/mo, Enterprise custom.',
    })
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <GlobalNavBar />

      {/* Hero */}
      <section className="pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 text-sm font-medium mb-6">
            <HardDrive className="w-4 h-4" />
            Shizuha Drive
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white tracking-tight">
            Simple pricing for your files
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Storage plans for individuals, teams, and organizations.
            Start free and upgrade when you need more space.
          </p>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8" id="pricing">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {TIERS.map((tier) => {
              const Icon = tier.icon
              return (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl border p-6 flex flex-col ${
                    tier.highlight
                      ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-900/10 dark:border-brand-500 ring-2 ring-brand-500/20'
                      : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                  }`}
                >
                  {tier.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="text-xs font-semibold bg-brand-600 text-white px-3 py-1 rounded-full">
                        Most popular
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      tier.highlight
                        ? 'bg-brand-600'
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
                          tier.highlight ? 'text-brand-600' : 'text-gray-400'
                        }`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={tier.href}
                    className={`mt-6 block w-full text-center rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                      tier.highlight
                        ? 'bg-brand-600 hover:bg-brand-700 text-white'
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

      {/* Waitlist CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8" id="waitlist">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Get early access
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Join the waitlist and be the first to know when Shizuha Drive launches.
          </p>
          <a
            href="/drive/waitlist"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 text-sm font-semibold transition-colors"
          >
            Join the Drive waitlist
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      <Footer />
    </div>
  )
}
