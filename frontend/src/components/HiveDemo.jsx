import { ArrowRight, PlayCircle } from 'lucide-react'

const HIVE_DEMO_VIDEO = '/demo/hive-demo.mp4'

export default function HiveDemo() {
  return (
    <section id="hive-demo" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 text-sm font-medium mb-5">
            <PlayCircle className="h-4 w-4" />
            Two-minute HIVE demo
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            See one HIVE agent task run end-to-end
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
            Watch HIVE take a plain-English research request, browse sources, structure the answer, and turn it into a reusable artifact.
          </p>
          <ul className="space-y-3 text-gray-600 dark:text-gray-400 mb-8">
            {[
              'Start from a real business prompt, not a scripted form.',
              'Follow live agent status from research through synthesis.',
              'End with a concise recommendation and a next-action checklist.',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-2 w-2 rounded-full bg-brand-500 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <a href="/id/register" className="btn-primary btn-lg inline-flex items-center gap-2 group">
            Join early access
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </a>
        </div>

        <div className="rounded-3xl bg-gray-900 dark:bg-black border border-gray-200/70 dark:border-gray-800 p-3 shadow-2xl">
          <video
            className="w-full rounded-2xl bg-black aspect-video"
            controls
            preload="metadata"
            poster="/demo/hive-demo-poster.svg"
          >
            <source src={HIVE_DEMO_VIDEO} type="video/mp4" />
            <a href={HIVE_DEMO_VIDEO}>Download the HIVE demo video</a>
          </video>
          <p className="px-2 pt-3 text-xs text-gray-400">
            Demo flow: research prompt → agent execution → structured summary → follow-up.
          </p>
        </div>
      </div>
    </section>
  )
}
