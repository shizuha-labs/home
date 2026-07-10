import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const indexPath = join(distDir, 'index.html')

const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const routes = [
  {
    // /forge itself had NO shell — nginx's `try_files $uri/` hit the bare
    // forge/ directory and returned 403 (operator 2026-07-10 tree audit).
    output: 'forge/index.html',
    title: 'Shizuha Forge — image generation API',
    description:
      'Generate images from one REST API call on self-hosted GPUs. 10 free images/day, then $0.02/image.',
  },
  {
    output: 'forge/pricing/index.html',
    title: 'Shizuha Forge API Pricing — 10 free images/day, then $0.02/image',
    description:
      'Generate images from one REST API call. Start with 10 free images per day, then pay $0.02 per image with GST-compliant invoicing.',
  },
  {
    output: 'forge/signup/index.html',
    title: 'Get a Shizuha Forge API Key',
    description:
      'Sign up for a Shizuha Forge API key and make your first image generation request with the free tier.',
  },
  {
    output: 'autonomous-org/index.html',
    title: 'Shizuha Autonomous Org — managed AI workforce for startups',
    description:
      'Shizuha provisions and operates a managed AI organization for your team: agents, workflows, knowledge, messaging, files, review gates, and human escalation.',
  },
  {
    output: 'dojo/index.html',
    title: 'DOJO Waitlist — AI Interview Prep by Shizuha',
    description:
      'Join the waitlist for DOJO, AI-powered mock interviews for coding, system design, and behavioral practice with structured feedback.',
  },
  {
    output: 'research/index.html',
    title: 'AI Search Visibility Audit — Shizuha Research',
    description:
      'Fixed-scope 24–48h AI-search/GEO visibility audit for ₹1,499, with a ₹0 sample and ₹2,499 audit-plus-recheck option. Intent only; no payment is collected.',
  },
  {
    output: 'research/order/index.html',
    title: 'Request a Research or AI-Search Audit — Shizuha',
    description:
      'Submit intent for a Shizuha research report or AI-search visibility audit. No payment is collected on this page and outcomes are not guaranteed.',
  },
  {
    output: 'forge/dashboard/index.html',
    title: 'Forge API Dashboard — Shizuha',
    description:
      'Manage your Shizuha Forge API key, usage, free-tier quota, billing status, and account settings.',
  },
]

const replaceTag = (html, pattern, replacement) => {
  if (!pattern.test(html)) {
    throw new Error(`route metadata generation failed: pattern ${pattern} not found`)
  }
  return html.replace(pattern, replacement)
}

const baseHtml = await readFile(indexPath, 'utf8')

for (const route of routes) {
  const title = escapeAttr(route.title)
  const description = escapeAttr(route.description)
  let html = baseHtml

  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`)
  html = replaceTag(html, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${description}" />`)
  html = replaceTag(html, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${title}" />`)
  html = replaceTag(html, /<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${description}" />`)

  const outputPath = join(distDir, route.output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, html)
}
