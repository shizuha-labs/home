import {
  Bot, GitBranch, Shield, FileText, BarChart3, Search,
  Terminal, Workflow, Brain, Wrench
} from 'lucide-react'
import { cn } from '../utils/cn'

const CAPABILITIES = [
  {
    icon: Bot,
    title: 'Autonomous Agents',
    description: '12 specialized AI agents — architects, engineers, QA, security, writers, analysts — each with dedicated roles and tool access.',
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-100 dark:bg-pink-900/30',
  },
  {
    icon: Workflow,
    title: 'Agentic Workflows',
    description: 'Agents collaborate across pods: architecture designs flow to engineering, code flows to QA, findings flow to docs — automatically.',
    color: 'text-brand-600 dark:text-brand-400',
    bgColor: 'bg-brand-100 dark:bg-brand-900/30',
  },
  {
    icon: Wrench,
    title: '15+ MCP Servers',
    description: 'Every service is agent-accessible via Model Context Protocol. Tasks, wiki, email, files, HR, finance — all exposed as tools.',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
  },
  {
    icon: Terminal,
    title: 'CLI-First',
    description: 'One command to install. Run prompts, start the HTTP API, or launch the full TUI. Works everywhere Node.js runs.',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  {
    icon: Brain,
    title: 'Multi-Provider',
    description: 'Claude, GPT, Codex, Gemini, or local models via Ollama. Switch providers per agent or per task. No vendor lock-in.',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
  },
  {
    icon: Shield,
    title: 'Sandboxed Execution',
    description: 'Agents run in isolated Docker containers with dropped capabilities, read-only filesystems, and network restrictions.',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
  {
    icon: GitBranch,
    title: 'Model Fallback Chains',
    description: 'Ordered list of provider/model pairs per agent. Primary fails? Automatically tries the next. Pins to whichever works.',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  {
    icon: Search,
    title: 'Multi-Channel',
    description: 'Agents respond on Telegram, Discord, WhatsApp, and the web dashboard. Same session, any channel. Fan-out keeps everyone in sync.',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
  },
]

const AGENT_EXAMPLES = [
  {
    prompt: 'shizuha exec -p "Create a new feature task in Pulse, assign to Kai, and draft the architecture doc in Wiki"',
    label: 'Cross-service workflow',
  },
  {
    prompt: 'shizuha exec -p "Audit all open PRs for OWASP Top 10 vulnerabilities and file findings"',
    label: 'Security scan',
  },
  {
    prompt: 'shizuha exec -p "Generate a monthly report from HR attendance, Finance transactions, and Time entries"',
    label: 'Analytics',
  },
]

export default function AgentCapabilities() {
  return (
    <section id="capabilities" className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Agentic by design
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Every service in Shizuha is built to be operated by AI agents. Not bolted on — architected from day one.
          </p>
        </div>

        {/* Capabilities grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8 mb-20">
          {CAPABILITIES.map((cap, index) => (
            <div
              key={cap.title}
              className="p-5 sm:p-8 rounded-2xl bg-gray-50 dark:bg-gray-800/50 animate-fade-in-up"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center mb-6', cap.bgColor)}>
                <cap.icon className={cn('h-6 w-6', cap.color)} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                {cap.title}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                {cap.description}
              </p>
            </div>
          ))}
        </div>

        {/* Example prompts */}
        <div className="max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-8 text-center">
            What your agents can do
          </h3>
          <div className="space-y-4">
            {AGENT_EXAMPLES.map((example, index) => (
              <div
                key={index}
                className="rounded-xl bg-gray-900 dark:bg-black border border-gray-700 dark:border-gray-800 overflow-hidden animate-fade-in-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-center justify-between px-4 py-2 bg-gray-800 dark:bg-gray-900 border-b border-gray-700/50">
                  <span className="text-xs text-gray-400 font-mono">{example.label}</span>
                </div>
                <div className="px-3 sm:px-4 py-3 font-mono text-[11px] sm:text-sm text-gray-300 overflow-x-auto">
                  <span className="text-green-400">$</span> {example.prompt}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
