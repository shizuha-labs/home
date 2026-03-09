import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronRight, Copy, Check, Terminal, BookOpen, ArrowLeft } from 'lucide-react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

// ── Code block with copy ──

function CodeBlock({ code, lang = 'bash', title }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.cssText = 'position:fixed;left:-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 my-4">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</span>
          <button onClick={copy} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}
      <div className="relative group">
        <pre className="bg-gray-900 dark:bg-black p-4 overflow-x-auto text-sm leading-relaxed">
          <code className="text-gray-100 font-mono">{code}</code>
        </pre>
        {!title && (
          <button onClick={copy} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-200">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  )
}

function InlineCode({ children }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-brand-600 dark:text-brand-400 text-sm font-mono">
      {children}
    </code>
  )
}

function Callout({ type = 'info', children }) {
  const styles = {
    info: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
    warning: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
    tip: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  }
  const labels = { info: 'Note', warning: 'Warning', tip: 'Tip' }
  return (
    <div className={`rounded-lg border px-4 py-3 my-4 text-sm ${styles[type]}`}>
      <span className="font-semibold">{labels[type]}: </span>
      {children}
    </div>
  )
}

// ── Table of Contents sections ──

const TOC = [
  { id: 'installation', title: 'Installation' },
  { id: 'quickstart', title: 'Quick Start' },
  { id: 'authentication', title: 'Authentication' },
  { id: 'daemon', title: 'Agent Daemon' },
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'cli-reference', title: 'CLI Reference' },
  { id: 'interactive-mode', title: 'Interactive Mode (TUI)' },
  { id: 'exec-mode', title: 'Exec Mode' },
  { id: 'agents', title: 'Agent Configuration' },
  { id: 'providers', title: 'LLM Providers' },
  { id: 'model-fallbacks', title: 'Model Fallback Chains' },
  { id: 'mcp', title: 'MCP Integration' },
  { id: 'permissions', title: 'Permission Modes' },
  { id: 'configuration', title: 'Configuration' },
  { id: 'gateway', title: 'Multi-Channel Gateway' },
  { id: 'fan-out', title: 'Fan-Out' },
  { id: 'tools', title: 'Built-in Tools' },
  { id: 'benchmarks', title: 'Benchmarks' },
  { id: 'api-reference', title: 'HTTP API' },
  { id: 'file-paths', title: 'File Paths' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
]

// ── Main page ──

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('installation')
  const location = useLocation()

  // Scroll to hash on load
  useEffect(() => {
    const hash = location.hash.replace('#', '')
    if (hash) {
      setActiveSection(hash)
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [location.hash])

  // Track scroll position for TOC highlighting
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )
    for (const section of TOC) {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <Navbar />

      <main className="flex-1 pt-16">
        <div className="max-w-[90rem] mx-auto flex">
          {/* Sidebar TOC */}
          <aside className="hidden lg:block w-64 flex-shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-gray-200 dark:border-gray-800 py-8 px-4">
            <a href="/" className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 mb-6 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </a>
            <div className="flex items-center gap-2 mb-6">
              <BookOpen className="w-5 h-5 text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Documentation</h2>
            </div>
            <nav className="space-y-0.5">
              {TOC.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    activeSection === item.id
                      ? 'bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-900'
                  }`}
                >
                  {item.title}
                </a>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 max-w-4xl px-6 sm:px-8 lg:px-12 py-10">
            {/* Hero */}
            <div className="mb-12">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
                <a href="/" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Home</a>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-gray-900 dark:text-white">Documentation</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4">
                Shizuha Runtime
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
                A universal coding agent with an LLM-powered agent loop, multi-provider support, built-in tools,
                MCP integration, and a web dashboard for managing your AI agent team.
              </p>
            </div>

            {/* ── Installation ── */}
            <Section id="installation" title="Installation">
              <P>Install the Shizuha runtime with a single command:</P>

              <H3>macOS / Linux</H3>
              <CodeBlock
                title="Terminal"
                code="curl -fsSL https://shizuha.com/install.sh | bash"
              />

              <H3>Windows (PowerShell)</H3>
              <CodeBlock
                title="PowerShell"
                code="irm https://shizuha.com/install.ps1 | iex"
              />

              <P>This downloads a self-contained binary (Node.js bundled), starts the daemon, and opens the dashboard at <InlineCode>http://localhost:8015</InlineCode>. No dependencies required.</P>

              <H3>Supported platforms</H3>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>Linux</strong> — x64, arm64 (systemd, sysvinit, Docker, Termux)</li>
                <li><strong>macOS</strong> — x64 (Intel), arm64 (Apple Silicon)</li>
                <li><strong>Windows</strong> — x64, arm64 (native or WSL)</li>
                <li><strong>Python 3.10+</strong> (optional, for MCP servers)</li>
              </ul>

              <H3>Verify installation</H3>
              <CodeBlock code={`shizuha --version`} />

              <H3>Manual installation</H3>
              <P>If you prefer to install manually:</P>
              <CodeBlock code={`git clone https://github.com/shizuha-trading/shizuha.git\ncd shizuha\nnpm install\nnpm run build\nnpm link`} />
            </Section>

            {/* ── Quick Start ── */}
            <Section id="quickstart" title="Quick Start">
              <P>The install script handles everything — installs, starts the daemon, opens the dashboard. That's it.</P>
              <P>Dashboard is at <InlineCode>http://localhost:8015</InlineCode>. The daemon auto-starts on boot and restarts on crash.</P>

              <H3>Authenticate (optional)</H3>
              <CodeBlock code="shizuha auth codex" />
              <P>Free with any ChatGPT account. Uses the device code flow — open the link in your browser, enter the code, done.
                Uses <InlineCode>gpt-5.3-codex</InlineCode> by default. You can switch models anytime with <InlineCode>/model</InlineCode> in the TUI.</P>

              <Callout type="tip">
                Other providers are also supported: <InlineCode>export ANTHROPIC_API_KEY=...</InlineCode> for Claude,
                {' '}<InlineCode>export OPENAI_API_KEY=...</InlineCode> for GPT, or install <a href="https://ollama.com" className="link">Ollama</a> for local models.
              </Callout>

              <H3>Interactive TUI</H3>
              <CodeBlock code="shizuha" />
              <P>Launch the interactive TUI for a rich coding agent experience directly in your terminal.</P>
            </Section>

            {/* ── Authentication ── */}
            <Section id="authentication" title="Authentication">
              <P>Shizuha uses multiple authentication systems depending on the LLM provider you're connecting to.</P>

              <H3>Shizuha ID (Platform login)</H3>
              <P>Optional. Connects to your organization's Shizuha platform for shared agents, task management, and MCP servers. The daemon works without login (local mode).</P>
              <CodeBlock title="Login" code="shizuha login" />
              <CodeBlock title="Login (interactive prompt)" code="shizuha login --username myuser" />
              <CodeBlock title="Logout" code="shizuha logout" />
              <Callout type="warning">
                Avoid passing passwords as command-line arguments — they're visible in process listings and shell history.
                Use the interactive prompt instead.
              </Callout>
              <P>Auth state is persisted in <InlineCode>~/.shizuha/auth.json</InlineCode> with restricted file permissions (600).</P>
              <Callout type="info">
                Logging out also stops the daemon. To switch accounts, log out and log in again.
              </Callout>

              <H3>Anthropic (Claude)</H3>
              <P>Claude models authenticate via API key:</P>
              <CodeBlock code={`export ANTHROPIC_API_KEY=sk-ant-...`} />
              <P>Or configure via the dashboard under <strong>Settings → Providers</strong>, or add directly to
                <InlineCode>~/.shizuha/credentials.json</InlineCode>.</P>

              <H3>OpenAI Codex (ChatGPT backend)</H3>
              <P>Uses device code OAuth flow, similar to GitHub CLI:</P>
              <CodeBlock code="shizuha auth codex" />
              <P>This opens a browser, where you log in with your ChatGPT account. Tokens are saved to the credential store.
                Multiple accounts are supported for rate-limit rotation.</P>

              <H3>OpenAI, Google, and others</H3>
              <P>Set API keys via environment variables or the dashboard:</P>
              <CodeBlock code={`export OPENAI_API_KEY=sk-...\nexport GOOGLE_API_KEY=AIza...\nexport OPENROUTER_API_KEY=sk-or-...`} />
              <P>Or configure them in the dashboard under <strong>Settings → Providers</strong>.</P>

              <H3>Check auth status</H3>
              <CodeBlock code="shizuha auth status" />
              <P>Shows the authentication status for all providers — Shizuha ID, Anthropic, OpenAI, Codex, Google, OpenRouter, and Ollama.</P>
            </Section>

            {/* ── Agent Daemon ── */}
            <Section id="daemon" title="Agent Daemon">
              <P>The daemon (<InlineCode>shizuha up</InlineCode>) is a background process that orchestrates all your AI agent runtimes,
                similar to how <InlineCode>tailscale up</InlineCode> connects your device to the mesh network.</P>

              <H3>Starting the daemon</H3>
              <CodeBlock code="shizuha up" />
              <P>What happens:</P>
              <ol className="list-decimal pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>Authenticates with the Shizuha platform using your stored credentials</li>
                <li>Discovers all agents assigned to your account via the platform API</li>
                <li>Forks a detached background daemon process</li>
                <li>Starts the web dashboard at <InlineCode>http://localhost:8015</InlineCode></li>
                <li>Agents start on-demand — when you send a message or explicitly enable them</li>
              </ol>

              <H3>Options</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Flag</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  <tr className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-4 font-mono text-xs">--agent &lt;name&gt;</td>
                    <td className="py-2">Start only specific agent(s) (comma-separated)</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-4 font-mono text-xs">--platform &lt;url&gt;</td>
                    <td className="py-2">Platform URL override (default: from login)</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-4 font-mono text-xs">--foreground</td>
                    <td className="py-2">Run in foreground (don't daemonize)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs">--bare-metal</td>
                    <td className="py-2">Run agents as local processes instead of Docker containers</td>
                  </tr>
                </tbody>
              </table>

              <H3>Stopping the daemon</H3>
              <CodeBlock code="shizuha down" />

              <H3>Checking status</H3>
              <CodeBlock code="shizuha status" />
              <P>Shows the daemon PID, uptime, connected agents, and their current state.</P>

              <Callout type="info">
                The daemon validates its PID on startup — stale state from crashed processes is automatically cleaned up.
                It's safe to run <InlineCode>shizuha up</InlineCode> multiple times.
              </Callout>
            </Section>

            {/* ── Dashboard ── */}
            <Section id="dashboard" title="Dashboard">
              <P>When the daemon is running, the web dashboard is available at <InlineCode>http://localhost:8015</InlineCode>.
                It provides a full-featured UI for managing your agent team.</P>

              <H3>Agent chat</H3>
              <P>Click any agent in the sidebar to start a conversation. Messages are relayed through a WebSocket bridge
                to the platform, so you see real-time streaming responses. The same agent conversations are synchronized
                across all your devices — start a chat on mobile, continue on the dashboard.</P>

              <H3>Agent management</H3>
              <P>Each agent shows a toggle switch to enable/disable its runtime. Agents default to off. When you send a message
                to a disabled agent, it automatically starts up. Only one device can run an agent at a time — new connections
                evict the previous one.</P>

              <H3>Settings</H3>
              <P>The settings panel (gear icon) has six sections:</P>
              <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>Profile</strong> — Login/logout, switch accounts. Shows token expiry times.</li>
                <li><strong>Agents</strong> — View all agents with their roles, models, skills, MCP servers, personality traits. Enable/disable with toggle switches.</li>
                <li><strong>Connection</strong> — Daemon status (PID, uptime, platform URL), connected runner list.</li>
                <li><strong>Fan-out</strong> — Control cross-channel broadcasting. When an agent responds on one channel (e.g., dashboard), toggle whether to broadcast to Telegram, Discord, WhatsApp, etc.</li>
                <li><strong>Providers</strong> — Full CRUD management for LLM provider credentials:
                  <ul className="list-disc pl-6 mt-1 space-y-1">
                    <li>Anthropic: add/remove API keys with labels</li>
                    <li>OpenAI: set/replace/remove API key</li>
                    <li>Google: set/replace/remove API key</li>
                    <li>Codex: manage ChatGPT accounts (add/remove by email)</li>
                  </ul>
                </li>
                <li><strong>Runtime</strong> — Node.js version, platform, memory usage, config file locations.</li>
              </ul>
            </Section>

            {/* ── CLI Reference ── */}
            <Section id="cli-reference" title="CLI Reference">
              <P>Complete list of all CLI commands:</P>

              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Command</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['shizuha', 'Launch interactive TUI (terminal user interface)'],
                    ['shizuha exec -p "..."', 'Execute a single prompt non-interactively'],
                    ['shizuha pipe', 'Persistent NDJSON pipe for warm pool integration'],
                    ['shizuha up', 'Start the agent runtime daemon'],
                    ['shizuha down', 'Stop the agent daemon'],
                    ['shizuha status', 'Show daemon and agent runtime status'],
                    ['shizuha login', 'Authenticate with Shizuha platform'],
                    ['shizuha logout', 'Clear authentication and stop daemon'],
                    ['shizuha auth codex', 'Authenticate with OpenAI Codex (device code flow)'],
                    ['shizuha auth status', 'Show authentication status for all providers'],
                    ['shizuha config', 'Show resolved configuration (all layers merged)'],
                    ['shizuha serve', 'Start HTTP API server (legacy)'],
                    ['shizuha gateway', 'Start persistent multi-channel gateway'],
                    ['shizuha pair', 'Generate device pairing code'],
                    ['shizuha devices list', 'List paired devices'],
                    ['shizuha devices revoke <id>', 'Revoke a paired device'],
                  ].map(([cmd, desc]) => (
                    <tr key={cmd} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{cmd}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* ── Interactive Mode ── */}
            <Section id="interactive-mode" title="Interactive Mode (TUI)">
              <P>Run <InlineCode>shizuha</InlineCode> with no arguments to launch the terminal user interface — a rich,
                full-screen agent experience built with Ink (React for the terminal).</P>
              <CodeBlock code="shizuha" />

              <H3>Features</H3>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>Multi-line input with syntax highlighting</li>
                <li>Real-time streaming responses with thinking indicators</li>
                <li>Tool call visualization with input/output display</li>
                <li>Session history with search</li>
                <li>Model picker (switch models mid-conversation)</li>
                <li>Permission approval dialogs (in supervised mode)</li>
                <li>File path autocomplete</li>
                <li>Diff visualization for file edits</li>
                <li>Status bar with token count, turn number, and timing</li>
              </ul>

              <H3>Options</H3>
              <CodeBlock code={`shizuha --model claude-sonnet-4-6   # Use specific model\nshizuha --mode autonomous          # Skip permission prompts\nshizuha --cwd /path/to/project     # Set working directory`} />

              <H3>Keyboard shortcuts</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Key</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Action</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['Enter', 'Send message'],
                    ['Shift+Enter', 'New line in input'],
                    ['Ctrl+C', 'Cancel current generation / exit'],
                    ['Ctrl+L', 'Clear screen'],
                    ['Tab', 'Autocomplete file paths'],
                    ['Up/Down', 'Scroll through history'],
                    ['?', 'Show help overlay'],
                  ].map(([key, action]) => (
                    <tr key={key} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs">{key}</td>
                      <td className="py-2">{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Callout type="tip">
                The TUI is completely independent from the daemon. You can run multiple TUI instances simultaneously,
                and they won't interfere with <InlineCode>shizuha up</InlineCode>.
              </Callout>
            </Section>

            {/* ── Exec Mode ── */}
            <Section id="exec-mode" title="Exec Mode">
              <P>Run a single prompt non-interactively. Ideal for scripts, CI/CD, and automation.</P>

              <CodeBlock title="Basic usage" code={`shizuha exec -p "Explain the architecture of this project"`} />
              <CodeBlock title="With options" code={`shizuha exec -p "Fix the failing test" \\\n  --model claude-opus-4-6 \\\n  --mode autonomous \\\n  --max-turns 10 \\\n  --thinking on`} />
              <CodeBlock title="JSON output" code={`shizuha exec -p "List all TODO comments" --json | jq '.type'`} />

              <H3>Options</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Flag</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['-p, --prompt <text>', 'The prompt to execute (required)'],
                    ['-m, --model <model>', 'Model to use (default: from config)'],
                    ['--mode <mode>', 'Permission mode: plan, supervised, autonomous (default: autonomous)'],
                    ['--max-turns <n>', 'Maximum agent turns (0 = unlimited)'],
                    ['--json', 'Output NDJSON events'],
                    ['--thinking <level>', 'Claude extended thinking: off, on'],
                    ['--effort <level>', 'Codex reasoning effort: low, medium, high, xhigh'],
                    ['--temperature <n>', 'LLM temperature (default: 0)'],
                    ['--cwd <dir>', 'Working directory'],
                    ['--mcp-server <cmd>', 'Add MCP server (stdio, repeatable)'],
                    ['--sandbox <mode>', 'OS-level sandbox mode'],
                  ].map(([flag, desc]) => (
                    <tr key={flag} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{flag}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>NDJSON output events</H3>
              <P>When using <InlineCode>--json</InlineCode>, the output is a stream of newline-delimited JSON events:</P>
              <CodeBlock code={`{"type":"session_start","session_id":"abc-123","model":"claude-opus-4-6"}
{"type":"content","content":"Let me analyze...","turn":1}
{"type":"tool_start","tool":"read","input":{"file_path":"/src/main.ts"}}
{"type":"tool_complete","tool":"read","output":"...file contents..."}
{"type":"reasoning","summary":"Identified the bug in line 42"}
{"type":"complete","stats":{"turns":3,"input_tokens":8421,"output_tokens":2103}}`} />
            </Section>

            {/* ── Agent Configuration ── */}
            <Section id="agents" title="Agent Configuration">
              <P>Shizuha supports a team of 12 AI agents organized into 6 pods. Each pod has two agents — one backed by
                Claude (Anthropic) and one by Codex (OpenAI) — for cross-model diversity and resilience.</P>

              <H3>Agent pods</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Pod</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Agents</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Responsibility</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['Architecture', 'Sora, Aoi', 'System design, HLD, API contracts, database schemas'],
                    ['Engineering', 'Kai, Ryo', 'Full-stack development, DevOps, testing, debugging'],
                    ['QA', 'Zen, Mika', 'User-perspective testing, acceptance, accessibility'],
                    ['Security', 'Akira, Ren', 'Vulnerability scanning, audits, penetration testing'],
                    ['Knowledge', 'Yuki, Haru', 'Documentation, wiki, research, onboarding guides'],
                    ['Analytics', 'Hana, Tomo', 'Data analysis, reporting, metrics dashboards'],
                  ].map(([pod, agents, desc]) => (
                    <tr key={pod} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{pod}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{agents}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>Agent properties</H3>
              <P>Each agent is configured with:</P>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>Execution method</strong> — <InlineCode>shizuha</InlineCode> (Anthropic models) or <InlineCode>codex</InlineCode> (OpenAI Codex)</li>
                <li><strong>Model overrides</strong> — Per-task model selection (e.g., use Opus for architecture, Sonnet for code)</li>
                <li><strong>Skills</strong> — Tagged capabilities like <InlineCode>backend</InlineCode>, <InlineCode>frontend</InlineCode>, <InlineCode>testing</InlineCode></li>
                <li><strong>Personality traits</strong> — Behavioral style (pragmatic, methodical, creative, etc.)</li>
                <li><strong>MCP servers</strong> — Which platform services the agent can access</li>
                <li><strong>Token budget</strong> — Monthly spending limits per agent</li>
                <li><strong>Concurrency</strong> — Maximum parallel tasks</li>
              </ul>

              <H3>Managing agents via the dashboard</H3>
              <P>In <strong>Settings → Agents</strong>, you can:</P>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>View all agents with their current status (running, idle, error)</li>
                <li>Toggle agents on/off with a switch</li>
                <li>Expand each agent to see full configuration (model, skills, MCP servers, personality)</li>
                <li>View runtime info (PID, token prefix, start time)</li>
              </ul>
            </Section>

            {/* ── LLM Providers ── */}
            <Section id="providers" title="LLM Providers">
              <P>Shizuha supports 8 LLM providers with automatic routing based on model name.</P>

              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Provider</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Models</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Auth</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['Anthropic', 'claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5', 'ANTHROPIC_API_KEY'],
                    ['OpenAI', 'gpt-4.1, o3-mini, o4-mini', 'OPENAI_API_KEY'],
                    ['Codex (ChatGPT)', 'gpt-5.3-codex, codex-mini-latest', 'Device auth (shizuha auth codex)'],
                    ['Google', 'gemini-2.0-flash, gemini-2.5-pro', 'GOOGLE_API_KEY'],
                    ['OpenRouter', 'Any model via proxy', 'OPENROUTER_API_KEY'],
                    ['Ollama', 'Any local model', 'None (local)'],
                    ['DeepSeek', 'deepseek-chat, deepseek-coder', 'DEEPSEEK_API_KEY'],
                    ['OpenAI-compatible', 'Mistral, xAI, Groq, Together', 'Per-provider env vars'],
                  ].map(([provider, models, auth]) => (
                    <tr key={provider} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{provider}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{models}</td>
                      <td className="py-2 text-xs">{auth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>Model aliases</H3>
              <P>For convenience, you can use short aliases:</P>
              <CodeBlock code={`shizuha exec -p "..." --model opus     # → claude-opus-4-6\nshizuha exec -p "..." --model sonnet   # → claude-sonnet-4-6\nshizuha exec -p "..." --model haiku    # → claude-haiku-4-5-20251001`} />

              <H3>Managing credentials</H3>
              <P>Provider credentials can be managed in three ways:</P>
              <ol className="list-decimal pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>Dashboard</strong> — Settings → Providers (add/remove tokens, API keys, accounts)</li>
                <li><strong>Environment variables</strong> — Standard env vars (<InlineCode>ANTHROPIC_API_KEY</InlineCode>, etc.)</li>
                <li><strong>Credential store</strong> — Edit <InlineCode>~/.shizuha/credentials.json</InlineCode> directly</li>
              </ol>

              <H3>Multi-key support</H3>
              <P>Anthropic supports multiple API keys with labels. Keys are randomly selected for load distribution,
                with automatic failover on errors. Codex supports multiple ChatGPT accounts with rate-limit-aware rotation.</P>
            </Section>

            {/* ── Model Fallback Chains ── */}
            <Section id="model-fallbacks" title="Model Fallback Chains">
              <P>Each agent can have an ordered list of (execution method, model) pairs. When the primary model fails
                (rate limit, server error, auth failure, connection issue), the runtime automatically tries the next model
                in the chain and <strong>pins</strong> to whichever succeeds.</P>

              <H3>How it works</H3>
              <ol className="list-decimal pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>Agent starts with the <strong>primary</strong> model (first entry in the chain)</li>
                <li>If it fails, tries each <strong>fallback</strong> in order</li>
                <li>Pins to whichever succeeds for subsequent turns and messages</li>
                <li>If the pinned model later fails, restarts the chain from the beginning</li>
                <li>Per-message model overrides bypass the chain entirely</li>
              </ol>

              <H3>Configuration</H3>
              <P>Configure in the dashboard under <strong>Settings → Agents → (expand agent) → Model Chain</strong>.
                Each entry has an execution method and model. Drag to reorder priority.</P>
              <CodeBlock code={`Priority 1 (primary):  shizuha  →  claude-opus-4-6
Priority 2 (fallback): codex    →  gpt-5.3-codex
Priority 3 (fallback): shizuha  →  claude-sonnet-4-6`} title="Example fallback chain" />

              <H3>Fallback events</H3>
              <P>When a fallback occurs, a <InlineCode>model_fallback</InlineCode> event is emitted on all channels.
                In the dashboard chat, this appears as a blockquote:
                <em> "Model fallback: claude-opus-4-6 failed, switching to gpt-5.3-codex"</em></P>

              <Callout type="tip">
                Combine fallback chains with Codex multi-account rotation for maximum resilience. If all Codex accounts
                are rate-limited, the agent automatically falls through to a Claude or Gemini fallback.
              </Callout>
            </Section>

            {/* ── MCP ── */}
            <Section id="mcp" title="MCP Integration">
              <P>Shizuha has full support for the <a href="https://modelcontextprotocol.io" className="link" target="_blank" rel="noopener noreferrer">Model Context Protocol</a>,
                allowing agents to connect to external tools and data sources.</P>

              <H3>Supported transports</H3>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>stdio</strong> — Subprocess communication (most common, works with any MCP-compatible client)</li>
                <li><strong>SSE</strong> — Server-Sent Events for long-running daemons</li>
                <li><strong>Streamable HTTP</strong> — HTTP with chunked streaming</li>
                <li><strong>WebSocket</strong> — Bidirectional real-time</li>
              </ul>

              <H3>Adding MCP servers via CLI</H3>
              <CodeBlock code={`shizuha exec -p "Query the database" \\\n  --mcp-server "npx @modelcontextprotocol/server-sqlite /path/to/db.sqlite"`} />

              <H3>Adding MCP servers via config</H3>
              <CodeBlock title=".shizuha/config.toml" lang="toml" code={`[[mcp.servers]]
name = "filesystem"
transport = "stdio"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user/docs"]

[[mcp.servers]]
name = "postgres"
transport = "sse"
url = "http://localhost:3001/sse"`} />

              <H3>Built-in Shizuha MCP servers</H3>
              <P>The platform includes 15+ MCP servers that connect agents to all Shizuha services:</P>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-4">
                {['Pulse (tasks)', 'Wiki (docs)', 'Drive (files)', 'Notes', 'Mail', 'Connect (social)',
                  'Admin', 'HR', 'Time', 'Finance', 'Books', 'Inventory', 'Cloud (SCS)', 'Identity (ID)', 'Notify'
                ].map((s) => (
                  <div key={s} className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
                    {s}
                  </div>
                ))}
              </div>

              <H3>Tool search</H3>
              <P>When MCP servers provide many tools, Shizuha uses deferred tool loading to save context tokens.
                Tools are loaded on-demand when the agent needs them, configured via:</P>
              <CodeBlock title=".shizuha/config.toml" lang="toml" code={`[mcp.toolSearch]
mode = "auto"           # auto, on, off
autoThresholdPercent = 10  # Load tools when they exceed 10% of context
maxResults = 5`} />
            </Section>

            {/* ── Permission Modes ── */}
            <Section id="permissions" title="Permission Modes">
              <P>Shizuha uses a three-tier permission system to control what tools the agent can use:</P>

              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Mode</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Behavior</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  <tr className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-4 font-mono text-xs">plan</td>
                    <td className="py-2">Read-only tools only. No file writes, no commands. Use for exploration and planning.</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-4 font-mono text-xs">supervised</td>
                    <td className="py-2">Low-risk tools auto-allowed (read, glob, grep). Medium/high-risk require interactive approval. Default for TUI.</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs">autonomous</td>
                    <td className="py-2">All tools auto-allowed. No approval prompts. Default for exec mode and agents.</td>
                  </tr>
                </tbody>
              </table>

              <H3>Custom permission rules</H3>
              <P>Fine-grained control over individual tools:</P>
              <CodeBlock title=".shizuha/config.toml" lang="toml" code={`[[permissions.rules]]
tool = "bash"
pattern = "rm -rf"
decision = "deny"

[[permissions.rules]]
tool = "write"
pattern = "*.env"
decision = "ask"

[[permissions.rules]]
tool = "read"
decision = "allow"`} />
            </Section>

            {/* ── Configuration ── */}
            <Section id="configuration" title="Configuration">
              <P>Shizuha uses a 4-layer TOML configuration system. Later layers override earlier ones.</P>

              <H3>Config file locations (in priority order)</H3>
              <ol className="list-decimal pl-6 space-y-2 text-gray-600 dark:text-gray-400 text-sm">
                <li><InlineCode>/etc/shizuha/config.toml</InlineCode> — Enterprise-wide defaults</li>
                <li><InlineCode>~/.config/shizuha/config.toml</InlineCode> — User preferences</li>
                <li><InlineCode>.shizuha/config.toml</InlineCode> — Project settings (committed to git)</li>
                <li><InlineCode>.shizuha/config.local.toml</InlineCode> — Local overrides (gitignored)</li>
              </ol>

              <H3>View resolved config</H3>
              <CodeBlock code="shizuha config" />

              <H3>Full configuration reference</H3>
              <CodeBlock title=".shizuha/config.toml" lang="toml" code={`# Agent settings
[agent]
defaultModel = "claude-sonnet-4-6"    # Default model
maxTurns = 0                          # Max turns (0 = unlimited)
maxContextTokens = 200000             # Context window for compaction
temperature = 0                       # LLM temperature
maxOutputTokens = 32000               # Max output per turn
cwd = "."                             # Working directory

# Permission mode
[permissions]
mode = "supervised"                   # plan, supervised, autonomous

# Custom permission rules
[[permissions.rules]]
tool = "bash"
decision = "ask"                      # allow, deny, ask

# LLM provider configuration
[providers.anthropic]
apiKey = "sk-ant-..."                 # Or use ANTHROPIC_API_KEY env
baseUrl = "https://api.anthropic.com" # Custom endpoint

[providers.openai]
apiKey = "sk-..."                     # Or use OPENAI_API_KEY env

[providers.google]
apiKey = "AIza..."                    # Or use GOOGLE_API_KEY env

[providers.ollama]
baseUrl = "http://localhost:11434"    # Ollama server URL

[providers.openrouter]
apiKey = "sk-or-..."
appName = "shizuha"

# MCP servers
[[mcp.servers]]
name = "my-server"
transport = "stdio"
command = "npx"
args = ["my-mcp-server"]

# Tool search for large MCP tool sets
[mcp.toolSearch]
mode = "auto"
autoThresholdPercent = 10
maxResults = 5

# Sandbox isolation
[sandbox]
mode = "unrestricted"                 # unrestricted, read-only, workspace-write, external
writablePaths = ["/tmp"]
networkAccess = false

# Hooks (pre/post tool execution)
[[hooks]]
event = "PreToolUse"
matcher = "bash"
command = "echo 'Running bash tool'"
timeout = 5000

# Logging
[logging]
level = "info"                        # debug, info, warn, error
file = "~/.shizuha/shizuha.log"`} />

              <H3>Data file locations</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">File</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Purpose</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['~/.shizuha/auth.json', 'Shizuha ID login credentials (JWT tokens)'],
                    ['~/.shizuha/credentials.json', 'LLM provider tokens and API keys'],
                    ['~/.shizuha/daemon.json', 'Daemon process state (PID, agents)'],
                    ['~/.shizuha/daemon.log', 'Daemon log output'],
                    ['~/.shizuha/sessions.db', 'SQLite database for session history'],
                    ['.shizuha/config.toml', 'Project-level configuration'],
                    ['.shizuha/config.local.toml', 'Local overrides (gitignored)'],
                  ].map(([file, purpose]) => (
                    <tr key={file} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{file}</td>
                      <td className="py-2">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* ── Multi-Channel Gateway ── */}
            <Section id="gateway" title="Multi-Channel Gateway">
              <P>The gateway mode (<InlineCode>shizuha gateway</InlineCode>) turns the agent into a persistent service
                that accepts messages from multiple channels simultaneously.</P>

              <H3>Supported channels</H3>
              <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400 text-sm">
                <li><strong>HTTP / Dashboard</strong> — Web interface at <InlineCode>http://localhost:8015</InlineCode></li>
                <li><strong>Shizuha Platform</strong> — WebSocket connection to the SaaS platform</li>
                <li><strong>Telegram</strong> — Connect as a Telegram bot</li>
                <li><strong>Discord</strong> — Connect as a Discord bot (mention, DM, or all messages)</li>
                <li><strong>WhatsApp</strong> — Connect via WhatsApp Business API</li>
              </ul>

              <H3>Telegram setup</H3>
              <CodeBlock code={`shizuha gateway \\\n  --telegram-token "123456:ABC..." \\\n  --telegram-chat-ids "12345,67890"`} />

              <H3>Discord setup</H3>
              <CodeBlock code={`shizuha gateway \\\n  --discord-token "MTk2..." \\\n  --discord-guild-ids "111,222" \\\n  --discord-mode mention    # mention, dm, or all`} />

              <H3>WhatsApp setup</H3>
              <CodeBlock code={`shizuha gateway \\\n  --whatsapp-token "EAAG..." \\\n  --whatsapp-phone-id "123456789" \\\n  --whatsapp-verify-token "my-verify-token" \\\n  --whatsapp-webhook-port 8016 \\\n  --whatsapp-numbers "+1234567890,+0987654321"`} />

              <H3>Cross-channel fan-out</H3>
              <P>When an agent responds on one channel, the response can be broadcast to other channels.
                Configure in the dashboard under <strong>Settings → Fan-out</strong>. See the <a href="#fan-out" className="link">Fan-out section</a> for details.</P>
            </Section>

            {/* ── Fan-Out ── */}
            <Section id="fan-out" title="Fan-Out">
              <P>Fan-out broadcasts agent events to all connected channels when the agent responds on any single channel.
                This ensures the agent's work is visible everywhere — start a conversation on Telegram, see the response
                appear in the dashboard and Discord simultaneously.</P>

              <H3>Per-channel defaults</H3>
              <table className="w-full text-sm my-4 border-collapse">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Channel</th>
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Default</th>
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Notes</th>
                </tr></thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['Web Dashboard', 'On', 'Always see agent activity'],
                    ['Shizuha WS', 'On', 'Platform WebSocket clients'],
                    ['Telegram', 'On', 'Broadcast to Telegram chat'],
                    ['Discord', 'On', 'Broadcast to Discord channel'],
                    ['WhatsApp', 'Off', 'Per-message cost — opt-in only'],
                    ['Slack', 'On', '—'],
                    ['CLI', 'Off', 'Terminal sessions are ephemeral'],
                  ].map(([ch, def, note]) => (
                    <tr key={ch} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2">{ch}</td>
                      <td className="py-2"><InlineCode>{def}</InlineCode></td>
                      <td className="py-2">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <P>Toggle fan-out per channel type in the dashboard under <strong>Settings → Fan-out</strong>, or via the
                daemon API at <InlineCode>PATCH /v1/settings</InlineCode>.</P>

              <Callout type="warning">
                WhatsApp is off by default because WhatsApp Business API charges per message sent. Enable only if you
                want agents to proactively notify via WhatsApp.
              </Callout>
            </Section>

            {/* ── Built-in Tools ── */}
            <Section id="tools" title="Built-in Tools">
              <P>Shizuha comes with 17 built-in tools available to the agent:</P>

              <H3>File operations</H3>
              <table className="w-full text-sm border-collapse my-4">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Tool</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-900 dark:text-white">Risk</th>
                    <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['read', 'Read-only', 'Read file contents with line numbers'],
                    ['write', 'Write', 'Create or overwrite a file'],
                    ['edit', 'Write', 'Edit files with exact string replacement (not diffs)'],
                    ['glob', 'Read-only', 'Search files by pattern (e.g., **/*.ts)'],
                    ['grep', 'Read-only', 'Search file contents with regex'],
                  ].map(([tool, risk, desc]) => (
                    <tr key={tool} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs">{tool}</td>
                      <td className="py-2 pr-4 text-xs">{risk}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>Execution</H3>
              <table className="w-full text-sm border-collapse my-4">
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['bash', 'Write', 'Execute shell commands (with timeout support)'],
                    ['notebook', 'Read-only', 'Execute Python/JavaScript notebooks'],
                    ['task', 'Async', 'Create background async tasks'],
                    ['task_output', 'Read-only', 'Read output from background tasks'],
                    ['task_stop', 'Write', 'Stop/cancel a background task'],
                  ].map(([tool, risk, desc]) => (
                    <tr key={tool} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs">{tool}</td>
                      <td className="py-2 pr-4 text-xs">{risk}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>Web & interaction</H3>
              <table className="w-full text-sm border-collapse my-4">
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['web_fetch', 'Read-only', 'Fetch and parse web pages'],
                    ['web_search', 'Read-only', 'Search the web'],
                    ['ask_user', 'Interactive', 'Prompt the user for input'],
                  ].map(([tool, risk, desc]) => (
                    <tr key={tool} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs">{tool}</td>
                      <td className="py-2 pr-4 text-xs">{risk}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <H3>Planning</H3>
              <table className="w-full text-sm border-collapse my-4">
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['todo_write', 'Write', 'Create/update a structured todo list'],
                    ['todo_read', 'Read-only', 'Read current todo list'],
                    ['enter_plan_mode', 'Special', 'Switch to plan-only mode (read-only)'],
                    ['exit_plan_mode', 'Special', 'Resume normal execution from plan mode'],
                  ].map(([tool, risk, desc]) => (
                    <tr key={tool} className="border-b border-gray-100 dark:border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs">{tool}</td>
                      <td className="py-2 pr-4 text-xs">{risk}</td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <P>MCP tools are namespaced as <InlineCode>mcp__&lt;server&gt;__&lt;tool&gt;</InlineCode>, e.g.,
                <InlineCode>mcp__pulse__create_task</InlineCode>.</P>
            </Section>

            {/* ── HTTP API ── */}
            <Section id="api-reference" title="HTTP API">
              <P>The daemon exposes a REST API at <InlineCode>http://localhost:8015</InlineCode>.</P>

              <H3>Health & status</H3>
              <CodeBlock code={`GET /health              # Health check\nGET /v1/status           # Daemon + runner status\nGET /v1/settings         # Full settings (identity, providers, agents, runtime)`} />

              <H3>Agents</H3>
              <CodeBlock code={`GET  /v1/agents          # List all agents with status\nPOST /v1/agents/toggle   # Enable/disable agent\n  Body: { "agent_id": "...", "enabled": true }`} />

              <H3>Authentication</H3>
              <CodeBlock code={`POST /v1/auth/login      # Login to Shizuha ID\n  Body: { "username": "...", "password": "..." }\n\nPOST /v1/auth/logout     # Clear auth credentials`} />

              <H3>Provider credentials</H3>
              <CodeBlock code={`# Anthropic API keys
POST   /v1/providers/anthropic/tokens           # Add API key
  Body: { "token": "sk-ant-...", "label": "my-key" }
DELETE /v1/providers/anthropic/tokens/:label     # Remove API key

# OpenAI / Google API keys
PUT    /v1/providers/openai                      # Set key
  Body: { "apiKey": "sk-..." }
PUT    /v1/providers/google                      # Set key
  Body: { "apiKey": "AIza..." }
DELETE /v1/providers/:provider                   # Remove provider

# Codex accounts (use 'shizuha auth codex' CLI for device auth flow)
DELETE /v1/providers/codex/accounts/:email        # Remove account`} />

              <H3>Models</H3>
              <CodeBlock code={`GET /v1/models            # List available models and providers`} />

              <H3>WebSocket</H3>
              <P>Chat is handled via WebSocket at <InlineCode>ws://localhost:8015/ws/chat</InlineCode>.
                Send messages as JSON:</P>
              <CodeBlock code={`// Send message to agent
{"type": "message", "agent_id": "uuid", "content": "Hello!"}

// Receive events
{"type": "message_ack", "execution_id": "uuid"}
{"type": "content", "content": "Hi there!", "execution_id": "uuid"}
{"type": "complete", "execution_id": "uuid"}`} />
            </Section>

            {/* ── Benchmarks ── */}
            <Section id="benchmarks" title="Benchmarks">
              <P>Shizuha Agent achieves <strong>87.0%</strong> on <a href="https://www.swebench.com/" className="link" target="_blank" rel="noopener noreferrer">SWE-bench Verified</a> — resolving 435 out of 500 real-world GitHub issues.</P>

              <table className="w-full text-sm my-4 border-collapse">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Rank</th>
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Agent</th>
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Score</th>
                </tr></thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['#1', 'Shizuha (gpt-5.3-codex)', '87.0%'],
                    ['#2', 'Claude Opus 4.5 (official)', '80.9%'],
                    ['#3', 'Claude Opus 4.6 (official)', '80.8%'],
                    ['#4', 'Gemini 3.1 Pro', '80.6%'],
                    ['#5', 'MiniMax M2.5', '80.2%'],
                    ['#6', 'GPT-5.2', '80.0%'],
                  ].map(([rank, agent, score]) => (
                    <tr key={rank} className={`border-b border-gray-100 dark:border-gray-800 ${rank === '#1' ? 'font-semibold text-gray-900 dark:text-white' : ''}`}>
                      <td className="py-2">{rank}</td>
                      <td className="py-2">{agent}</td>
                      <td className="py-2">{score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Callout type="info">
                Methodology: Best-of-k across 24 evaluation runs with gpt-5.3-codex (xhigh reasoning, autonomous mode,
                45-min timeout per instance). Public leaderboard scores are typically pass@1.
                See <a href="https://shizuha.com/benchmarks" className="link" target="_blank" rel="noopener noreferrer">full benchmark details</a> for transparency notes.
              </Callout>
            </Section>

            {/* ── File Paths ── */}
            <Section id="file-paths" title="File Paths">
              <P>All Shizuha data is stored under <InlineCode>~/.shizuha/</InlineCode>.</P>

              <table className="w-full text-sm my-4 border-collapse">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Path</th>
                  <th className="text-left py-2 font-medium text-gray-900 dark:text-white">Description</th>
                </tr></thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  {[
                    ['~/.shizuha/config.toml', 'Global configuration'],
                    ['~/.shizuha/auth.json', 'Platform authentication'],
                    ['~/.shizuha/credentials.json', 'Provider credentials (Codex accounts, API keys)'],
                    ['~/.shizuha/daemon.log', 'Daemon log output'],
                    ['~/.shizuha/daemon.state.json', 'Daemon process state (PID, agents)'],
                    ['~/.shizuha/agents.enabled', 'Persisted agent enable/disable state'],
                    ['~/.shizuha/agents/{username}/agent.toml', 'Per-agent model/config overrides'],
                    ['~/.shizuha/agents/{username}/CLAUDE.md', 'Per-agent system instructions'],
                    ['~/.shizuha/agents/{username}/state.db', 'Per-agent session SQLite DB'],
                    ['~/.local/bin/shizuha', 'Binary symlink'],
                  ].map(([path, desc]) => (
                    <tr key={path} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2"><InlineCode>{path}</InlineCode></td>
                      <td className="py-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Callout type="warning">
                <InlineCode>rm -rf ~/.shizuha</InlineCode> deletes all credentials, session history, and daemon state.
                You will need to reconfigure everything from scratch.
              </Callout>
            </Section>

            {/* ── Troubleshooting ── */}
            <Section id="troubleshooting" title="Troubleshooting">

              <H3>Daemon won't start</H3>
              <CodeBlock code={`# Check if already running\nshizuha status\n\n# Force stop and restart\nshizuha down\nshizuha up --foreground    # Run in foreground to see errors`} />

              <H3>Authentication errors</H3>
              <CodeBlock code={`# Check all auth status\nshizuha auth status\n\n# Re-login\nshizuha logout\nshizuha login`} />
              <Callout type="warning">
                Never share the contents of <InlineCode>~/.shizuha/auth.json</InlineCode> or <InlineCode>~/.shizuha/credentials.json</InlineCode> — they contain authentication tokens.
              </Callout>

              <H3>Agent not responding</H3>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>Check the agent is enabled in <strong>Settings → Agents</strong></li>
                <li>Check the daemon log: <InlineCode>cat ~/.shizuha/daemon.log</InlineCode></li>
                <li>Verify the provider is configured: <InlineCode>shizuha auth status</InlineCode></li>
                <li>Try a different model: agents may fail if the configured model's provider isn't authenticated</li>
              </ul>

              <H3>Provider rate limits</H3>
              <P>If you see 429 errors:</P>
              <ul className="list-disc pl-6 space-y-1 text-gray-600 dark:text-gray-400 text-sm">
                <li>Anthropic: Add more API keys in Settings → Providers (supports multi-key rotation)</li>
                <li>Codex: Add more ChatGPT accounts via <InlineCode>shizuha auth codex</InlineCode></li>
                <li>OpenAI: Upgrade your API plan or add rate limit headers</li>
              </ul>

              <H3>MCP server connection failures</H3>
              <CodeBlock code={`# Check if MCP daemon is running\nnetstat -tlnp | grep 1810\n\n# View resolved config to see MCP servers\nshizuha config | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('mcp',{}), indent=2))"`} />

              <H3>Reset everything</H3>
              <CodeBlock code={`# Nuclear option — clear all state\nshizuha down\nrm -rf ~/.shizuha\nshizuha login\nshizuha up`} />

              <Callout type="warning">
                Resetting deletes all credentials, session history, and daemon state. You'll need to reconfigure providers and re-authenticate.
              </Callout>
            </Section>

            {/* Footer spacer */}
            <div className="h-20" />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}

// ── Typography helpers ──

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-4 pb-3 border-b border-gray-200 dark:border-gray-800">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function H3({ children }) {
  return <h3 className="text-lg font-semibold text-gray-900 dark:text-white mt-6 mb-2">{children}</h3>
}

function P({ children }) {
  return <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{children}</p>
}
