import { KeyRound, Layers, Server, Globe } from 'lucide-react'
import { cn } from '../utils/cn'

const FEATURES = [
  {
    icon: KeyRound,
    title: 'Single Sign-On',
    description:
      'One account across all services. JWT-based federated auth means agents and humans share the same identity layer.',
    color: 'text-brand-600 dark:text-brand-400',
    bgColor: 'bg-brand-100 dark:bg-brand-900/50',
  },
  {
    icon: Layers,
    title: 'Tight Integration',
    description:
      'Create a task from an email, link docs to projects, track time on tasks, generate invoices from timesheets — all connected.',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/50',
  },
  {
    icon: Server,
    title: 'Self-Hosted',
    description:
      'Run everything on your own infrastructure. Docker Compose up and you have the entire platform. No cloud dependency.',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/50',
  },
  {
    icon: Globe,
    title: 'Open MCP Protocol',
    description:
      'All services expose tools via the Model Context Protocol standard. Bring your own agents or use ours — the tools work with any MCP client.',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/50',
  },
]

export default function FeatureSection() {
  return (
    <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Built different
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Not another SaaS suite. A self-hosted platform where AI agents are first-class citizens.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
          {FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              className={cn(
                'p-5 sm:p-8 rounded-2xl bg-gray-50 dark:bg-gray-800/50',
                'animate-fade-in-up'
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center mb-6',
                  feature.bgColor
                )}
              >
                <feature.icon className={cn('h-6 w-6', feature.color)} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                {feature.title}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
