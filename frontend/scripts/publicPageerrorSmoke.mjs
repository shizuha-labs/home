import { chromium } from 'playwright-core'

const base = (process.env.PUBLIC_BASE || 'https://shizuha.com').replace(/\/$/, '')
const paths = (process.env.PUBLIC_PATHS || '/, /dojo, /forge/, /research, /docs')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
const browser = await chromium.launch({ headless: true })

const failures = []
for (const path of paths) {
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`
  console.log(`SMOKE visiting ${url}`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const pageerrors = []
  page.on('pageerror', (err) => pageerrors.push(String(err)))
  let status = null
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    status = resp?.status() ?? null
    await page.waitForTimeout(2000)
  } catch (err) {
    failures.push({ url, status, error: String(err), pageerrors })
    await context.close()
    continue
  }
  if (status && status >= 500) {
    failures.push({ url, status, error: `HTTP ${status}`, pageerrors })
  } else if (pageerrors.length) {
    failures.push({ url, status, error: 'pageerror', pageerrors })
  }
  await context.close()
}
await browser.close()

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2))
  process.exit(2)
}
console.log(JSON.stringify({ ok: true, paths, base }))
