import { readFileSync } from 'node:fs'

const conf = readFileSync(new URL('../../nginx.prod.conf', import.meta.url), 'utf8')

const retryDirectives = [
  'proxy_next_upstream error timeout http_502 http_503 http_504;',
  'proxy_next_upstream_tries 3;',
  'proxy_next_upstream_timeout 4s;',
]

if (!/location\s+~\s+\^\/api\/research\(\/\|\$\)/.test(conf)) {
  throw new Error('nginx.prod.conf must proxy /api/research* to the home backend')
}

const researchBlock = conf.match(/location\s+~\s+\^\/api\/research\(\/\|\$\)\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body ?? ''
if (!researchBlock.includes('proxy_pass http://shizuha-home-backend.shizuha.svc.cluster.local:8031;')) {
  throw new Error('research API nginx location must proxy to shizuha-home-backend')
}

const homeBlock = conf.match(/location\s+\/api\/home\/\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body ?? ''
for (const directive of retryDirectives) {
  if (!homeBlock.includes(directive)) {
    throw new Error(`home API nginx location must include HA retry directive: ${directive}`)
  }
  if (!researchBlock.includes(directive)) {
    throw new Error(`research API nginx location must include HA retry directive: ${directive}`)
  }
}
