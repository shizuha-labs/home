import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/pages/ResearchOrderPage.jsx'), 'utf8')

const required = [
  '/api/research/audit-leads',
  'DPDP notice at collection',
  '45 days',
  'not a purchase',
  'privacy@shizuha.com',
  'disclaimer_version',
  'dpdp_notice_version',
  'company_website',
  'No payment is collected',
  'will not fetch your live site',
  'not guaranteed',
]

for (const text of required) {
  if (!source.includes(text)) {
    throw new Error(`Research order guardrail copy is missing: ${text}`)
  }
}

const forbidden = [
  '/api/forge/signup',
  'name="card"',
  'payment_token',
  'payment_provider',
]

for (const text of forbidden) {
  if (source.includes(text)) {
    throw new Error(`Research order page still contains forbidden intake/payment wording: ${text}`)
  }
}

console.log('Research order guardrail copy OK')
