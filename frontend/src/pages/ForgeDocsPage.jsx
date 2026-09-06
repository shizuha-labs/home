import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GlobalNavBar from '../components/shared/GlobalNavBar'
import Footer from '../components/Footer'

// VEN-174: the documented developer-docs URL (shizuha.com/forge/docs) previously
// fell through to the generic SPA shell — anything linking to it (emails, pricing
// CTAs, external posts) landed on a blank page. This renders the real Forge API
// reference at that route. Content is the live-verified request shape + snippets +
// error bodies also used on the Forge landing page (kept in sync deliberately).

const CURL_SNIPPET = `curl -X POST https://shizuha.com/api/forge/generate \\
  -H "X-API-Key: $FORGE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "a red fox in snow, golden hour, photorealistic"}'`

const PYTHON_SNIPPET = `import requests

resp = requests.post(
    "https://shizuha.com/api/forge/generate",
    headers={"X-API-Key": "YOUR_FORGE_KEY"},
    json={"prompt": "a red fox in snow, golden hour, photorealistic"},
    timeout=120,
)
resp.raise_for_status()          # 401 bad key · 422 bad body · 429 daily limit
print(resp.json())               # -> generated image payload`

const JS_SNIPPET = `const resp = await fetch("https://shizuha.com/api/forge/generate", {
  method: "POST",
  headers: {
    "X-API-Key": "YOUR_FORGE_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt: "a red fox in snow, golden hour, photorealistic" }),
})
if (!resp.ok) throw new Error(\`Forge error \${resp.status}\`)  // 401/422/429/5xx
console.log(await resp.json())   // -> generated image payload`

const REQUEST_SNIPPET = `POST /api/forge/generate
Host: shizuha.com
X-API-Key: <your key>
Content-Type: application/json

{ "prompt": "a red fox in snow, golden hour, photorealistic" }`

const RETRY_SNIPPET = `HTTP/1.1 429 Too Many Requests
Retry-After: <seconds until your daily window resets>

{"detail": "Daily free limit reached (10/day). Retry after the reset, or switch to pay-as-you-go ($0.02/image)."}`

// Live-confirmed shapes (see the Forge landing page): 422 = FastAPI validation
// array; 401 = {"detail": "..."}.
const STATUS_CODES = [
  ['200', 'Success', 'Generated image payload in the JSON body.'],
  ['401', 'Missing / invalid key', '{"detail": "Missing API key. Send it in the X-API-Key header. Get one at shizuha.com/forge."}'],
  ['401', 'Revoked key', '{"detail": "Invalid or revoked API key."}'],
  ['422', 'Missing / bad prompt', '{"detail": [{"type": "missing", "loc": ["body", "prompt"], "msg": "Field required"}]}'],
  ['429', 'Daily free limit reached', '{"detail": "Daily free limit reached (10/day)."} + Retry-After header'],
  ['5xx', 'Transient backend error', 'Retry with exponential backoff.'],
]

function CodeBlock({ children }) {
  return (
    <pre className="text-left text-xs sm:text-sm bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto border border-gray-800">
      <code>{children}</code>
    </pre>
  )
}

function CopyableCode({ label, children }) {
  const [copied, setCopied] = useState(false)
  function onCopy() {
    try {
      navigator.clipboard?.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — the snippet is still selectable inline.
    }
  }
  return (
    <div className="relative">
      {label && (
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      )}
      <button
        type="button" onClick={onCopy}
        className="absolute right-2 top-7 z-10 rounded-md bg-gray-800/80 hover:bg-gray-700 text-gray-100 text-xs px-2 py-1 border border-gray-700"
        aria-label={`Copy ${label} example`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <CodeBlock>{children}</CodeBlock>
    </div>
  )
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-4 space-y-4 text-gray-600 dark:text-gray-300">{children}</div>
    </section>
  )
}

export default function ForgeDocsPage() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Forge API Documentation — Shizuha'
    return () => { document.title = prev }
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <GlobalNavBar />
      <main className="flex-1">
        <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <div className="max-w-3xl mx-auto">
            <header className="text-center">
              <p className="text-xs font-mono uppercase tracking-widest text-brand-600 dark:text-brand-400">Forge API</p>
              <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Developer Documentation
              </h1>
              <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
                Generate images from a single authenticated REST call — no GPU to provision, no SDK required.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link to="/forge" className="inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                  Get an API key
                </Link>
                <Link to="/forge/pricing" className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-900">
                  Pricing
                </Link>
              </div>
            </header>

            <div className="mt-14 space-y-14">
              <Section id="overview" title="Overview">
                <p>
                  Forge is Shizuha’s image-generation API. One <code>POST</code> request with your API key
                  returns a generated image — it runs on Shizuha’s own India-based GPU infrastructure.
                  Every request uses the same shape shown below; the examples are the product.
                </p>
              </Section>

              <Section id="authentication" title="Authentication">
                <p>
                  Authenticate every request with your API key in the <code>X-API-Key</code> header. Create a
                  key at <Link to="/forge" className="text-brand-600 dark:text-brand-400 underline">shizuha.com/forge</Link>{' '}
                  and keep it secret — treat it like a password.
                </p>
                <CodeBlock>{`X-API-Key: <your key>`}</CodeBlock>
              </Section>

              <Section id="endpoint" title="Endpoint">
                <p>
                  <code>POST https://shizuha.com/api/forge/generate</code> — body is JSON with a single
                  required <code>prompt</code> string. Content type <code>application/json</code>.
                </p>
                <CopyableCode label="Request">{REQUEST_SNIPPET}</CopyableCode>
              </Section>

              <Section id="rate-limits" title="Rate limits & pricing">
                <p>
                  The free tier allows <strong>10 images/day</strong>. Beyond that, pay-as-you-go is a flat{' '}
                  <strong>$0.02/image</strong> — no opaque credit math. When you exceed the daily free window
                  the API returns <code>429</code> with a <code>Retry-After</code> header:
                </p>
                <CodeBlock>{RETRY_SNIPPET}</CodeBlock>
                <p>
                  See <Link to="/forge/pricing" className="text-brand-600 dark:text-brand-400 underline">Forge pricing</Link> for full details.
                </p>
              </Section>

              <Section id="examples" title="Examples">
                <p>Copy-paste-ship in curl, Python, or JavaScript — the same request shape in each.</p>
                <CopyableCode label="curl">{CURL_SNIPPET}</CopyableCode>
                <CopyableCode label="Python">{PYTHON_SNIPPET}</CopyableCode>
                <CopyableCode label="JavaScript">{JS_SNIPPET}</CopyableCode>
              </Section>

              <Section id="status-codes" title="Status codes">
                <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Code</th>
                        <th className="px-4 py-3 font-medium">Meaning</th>
                        <th className="px-4 py-3 font-medium">Body</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {STATUS_CODES.map(([code, meaning, body], i) => (
                        <tr key={i} className="align-top">
                          <td className="px-4 py-3 font-mono text-gray-900 dark:text-gray-100">{code}</td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{meaning}</td>
                          <td className="px-4 py-3"><code className="text-xs text-gray-600 dark:text-gray-400 break-all">{body}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  On <code>5xx</code> errors, retry with exponential backoff. <code>401</code>/<code>422</code>{' '}
                  are client errors — fix the key or the request body rather than retrying.
                </p>
              </Section>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
