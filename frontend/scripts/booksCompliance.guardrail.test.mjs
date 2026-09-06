import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, html, generator, nginx, page] = await Promise.all([
  readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('./generate-route-html.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../nginx.prod.conf', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/BooksCompliancePage.jsx', import.meta.url), 'utf8'),
])
assert.match(app, /path="\/books\/compliance"/)
assert.match(app, /path="\/books\/compliance\/pricing"/)
assert.match(app, /path="\/books\/compliance\/confirmation"/)
assert.match(generator, /books\/compliance\/index\.html/)
assert.match(generator, /books\/compliance\/pricing\/index\.html/)
assert.match(generator, /books\/compliance\/confirmation\/index\.html/)
assert.match(html, /!window\.location\.pathname\.startsWith\('\/books\/compliance'\)/)
assert.doesNotMatch(html, /<script[^>]+src="https:\/\/plausible\.io/)
assert.match(nginx, /location \^~ \/api\/books\/compliance\//)
assert.match(nginx, /location = \/books\/compliance\/confirmation[\s\S]+access_log off/)
assert.match(page, /No real identifiers, parties, documents or financial figures/)
assert.doesNotMatch(page, /PAN\s*\/\s*TAN\s*\/\s*GSTIN[^\n]+value=/i)
console.log('books compliance route/privacy guards: ok')
