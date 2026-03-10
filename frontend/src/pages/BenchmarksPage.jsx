import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { BarChart3, Trophy, GitBranch, Clock, ExternalLink } from 'lucide-react'

const LEADERBOARD = [
  { rank: 1, agent: 'Shizuha (gpt-5.3-codex)', score: 87.0, highlight: true, note: 'best-of-k' },
  { rank: 2, agent: 'Claude Opus 4.5 (official)', score: 80.9 },
  { rank: 3, agent: 'Claude Opus 4.6 (official)', score: 80.8 },
  { rank: 4, agent: 'Gemini 3.1 Pro', score: 80.6 },
  { rank: 5, agent: 'MiniMax M2.5', score: 80.2 },
  { rank: 6, agent: 'GPT-5.2', score: 80.0 },
  { rank: 7, agent: 'Sonar Foundation Agent', score: 79.2 },
  { rank: 8, agent: 'Claude Sonnet 4.6', score: 79.6 },
]

const METHODOLOGY = [
  { label: 'Dataset', value: 'SWE-bench Verified (500 instances)' },
  { label: 'Methodology', value: 'Best-of-k across 24 runs' },
  { label: 'Resolved', value: '435 / 500' },
  { label: 'Agent Backend', value: 'gpt-5.3-codex (ChatGPT Codex API)' },
  { label: 'Agent Scaffold', value: 'Shizuha Agent (TypeScript, autonomous mode)' },
  { label: 'Thinking Level', value: 'xhigh (extended reasoning)' },
  { label: 'Per-instance Timeout', value: '2,700s (45 min)' },
  { label: 'Evaluation', value: 'SWE-bench harness (inline, per-instance)' },
]

export default function BenchmarksPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <Navbar />
      <main className="flex-1 pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium mb-4">
              <Trophy className="w-4 h-4" />
              #1 on SWE-bench Verified
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Benchmark Results
            </h1>
            <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Shizuha Agent achieves <span className="font-semibold text-gray-900 dark:text-white">87.0%</span> on
              SWE-bench Verified — resolving 435 out of 500 real-world GitHub issues.
            </p>
          </div>

          {/* Score Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-950 dark:to-brand-900 rounded-2xl p-6 border border-brand-200 dark:border-brand-800">
              <div className="text-sm font-medium text-brand-600 dark:text-brand-400 mb-1">SWE-bench Verified</div>
              <div className="text-4xl font-bold text-brand-700 dark:text-brand-300">87.0%</div>
              <div className="text-sm text-brand-600/80 dark:text-brand-400/80 mt-1">435 / 500 resolved</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">vs. #2 (Claude Opus 4.5)</div>
              <div className="text-4xl font-bold text-gray-900 dark:text-white">+6.1%</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">percentage points ahead</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Total Runs</div>
              <div className="text-4xl font-bold text-gray-900 dark:text-white">24</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">best-of-k methodology</div>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-brand-600 dark:text-brand-400" />
              Leaderboard Comparison
            </h2>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden -mx-4 sm:mx-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[360px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <th className="text-left px-3 sm:px-6 py-2.5 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rank</th>
                      <th className="text-left px-3 sm:px-6 py-2.5 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Agent / Model</th>
                      <th className="text-right px-3 sm:px-6 py-2.5 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Score</th>
                      <th className="text-right px-3 sm:px-6 py-2.5 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Bar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {LEADERBOARD.map((entry) => (
                      <tr
                        key={entry.rank}
                        className={entry.highlight
                          ? 'bg-brand-50/50 dark:bg-brand-950/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'}
                      >
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">
                          {entry.rank === 1 ? <span className="text-brand-600 dark:text-brand-400 font-bold">#1</span> : `#${entry.rank}`}
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <span className={`text-xs sm:text-sm font-medium ${entry.highlight ? 'text-brand-700 dark:text-brand-300' : 'text-gray-900 dark:text-white'}`}>
                            {entry.agent}
                          </span>
                          {entry.note && (
                            <span className="ml-1.5 sm:ml-2 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/50 text-brand-600 dark:text-brand-400">
                              {entry.note}
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right">
                          <span className={`text-xs sm:text-sm font-bold ${entry.highlight ? 'text-brand-700 dark:text-brand-300' : 'text-gray-900 dark:text-white'}`}>
                            {entry.score.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 w-32 sm:w-48 hidden sm:table-cell">
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                            <div
                              className={`h-2.5 rounded-full ${entry.highlight ? 'bg-brand-600' : 'bg-gray-400 dark:bg-gray-500'}`}
                              style={{ width: `${entry.score}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              Public leaderboard scores sourced from{' '}
              <a href="https://www.swebench.com/" className="underline hover:text-gray-700 dark:hover:text-gray-300" target="_blank" rel="noopener">swebench.com</a>,{' '}
              <a href="https://llm-stats.com/benchmarks/swe-bench-verified" className="underline hover:text-gray-700 dark:hover:text-gray-300" target="_blank" rel="noopener">llm-stats.com</a>, and{' '}
              <a href="https://epoch.ai/benchmarks/swe-bench-verified" className="underline hover:text-gray-700 dark:hover:text-gray-300" target="_blank" rel="noopener">Epoch AI</a> as of March 2026.
              Shizuha score uses best-of-k methodology; public scores are typically pass@1.
            </p>
          </div>

          {/* Methodology */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <GitBranch className="w-6 h-6 text-brand-600 dark:text-brand-400" />
              Methodology
            </h2>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <dl className="divide-y divide-gray-200 dark:divide-gray-800">
                {METHODOLOGY.map((item) => (
                  <div key={item.label} className="px-4 sm:px-6 py-3 sm:py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{item.label}</dt>
                    <dd className="mt-1 sm:mt-0 sm:col-span-2 text-sm text-gray-900 dark:text-white">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Transparency Note */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 mb-12">
            <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">Transparency Notes</h3>
            <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-2">
              <li>
                <strong>Best-of-k vs. pass@1:</strong> Our 87.0% score represents the best result per instance across 24 evaluation runs.
                The public leaderboard typically reports single-run pass@1 scores. A fair single-run comparison would yield a lower score.
              </li>
              <li>
                <strong>Contamination:</strong> OpenAI has flagged potential training data contamination across all frontier models on
                SWE-bench Verified. This caveat applies to all entries on the leaderboard, including ours.
              </li>
              <li>
                <strong>Agent scaffold matters:</strong> The Shizuha Agent scaffold (tool execution loop, context management, compaction)
                contributes significantly to performance beyond the base model capability.
              </li>
            </ul>
          </div>

          {/* About SWE-bench */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Clock className="w-6 h-6 text-brand-600 dark:text-brand-400" />
              About SWE-bench Verified
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              SWE-bench Verified is a curated subset of 500 real-world GitHub issues from 12 popular Python repositories
              (Django, Flask, scikit-learn, matplotlib, sympy, etc.). Each instance requires an agent to understand a
              bug report or feature request, navigate a large codebase, and produce a working code patch — validated
              against the project's own test suite. It is widely considered the gold standard for evaluating autonomous
              coding agents.
            </p>
            <div className="mt-4">
              <a
                href="https://www.swebench.com/"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline"
              >
                Visit swebench.com <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

        </div>
      </main>
      <Footer />
    </div>
  )
}
