import { ArrowRight, Sparkles, Bot, Zap } from 'lucide-react'

export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 gradient-hero-light -z-10" />

      {/* Decorative elements */}
      <div className="absolute top-40 left-10 w-72 h-72 bg-brand-400/20 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl -z-10" />

      <div className="max-w-5xl mx-auto text-center">
        {/* Brand Name with Japanese */}
        <div className="mb-6 animate-fade-in flex items-center justify-center gap-4">
          <span className="text-5xl sm:text-6xl lg:text-7xl font-light text-brand-400 dark:text-brand-300 select-none">
            静葉
          </span>
          <span className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-800 dark:text-white">
            Shizuha
          </span>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 text-sm font-medium mb-8 animate-fade-in">
          <Sparkles className="h-4 w-4" />
          <span>AI-powered unified platform</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6 animate-fade-in-up">
          One platform.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-purple-600 dark:from-brand-400 dark:to-purple-400">
            All connected.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 mb-6 max-w-3xl mx-auto animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          15+ integrated apps with AI that understands your entire workflow. Tasks, docs, email, files, finance - seamlessly connected with intelligent automation.
        </p>

        {/* AI Feature highlights */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-10 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 text-sm">
            <Bot className="h-4 w-4" />
            <span>AI Agent</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm">
            <Zap className="h-4 w-4" />
            <span>Cross-app workflows</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm">
            <Sparkles className="h-4 w-4" />
            <span>Smart automation</span>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <a
            href="/id/register"
            className="btn-primary btn-lg flex items-center gap-2 group"
          >
            Get Started Free
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </a>
          <a
            href="/id/login"
            className="btn-outline btn-lg"
          >
            Sign In
          </a>
        </div>

        {/* Trust indicator */}
        <p className="mt-8 text-sm text-gray-500 dark:text-gray-500 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          No credit card required. Start with unlimited access.
        </p>
      </div>
    </section>
  )
}
