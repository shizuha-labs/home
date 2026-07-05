import { readFileSync } from 'node:fs'

const conf = readFileSync(new URL('../../nginx.prod.conf', import.meta.url), 'utf8')

if (!/location\s+~\s+\^\/api\/research\(\/\|\$\)/.test(conf)) {
  throw new Error('nginx.prod.conf must proxy /api/research* to the home backend')
}

const researchBlock = conf.match(/location\s+~\s+\^\/api\/research\(\/\|\$\)\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body ?? ''
if (!researchBlock.includes('proxy_pass http://shizuha-home-backend.shizuha.svc.cluster.local:8031;')) {
  throw new Error('research API nginx location must proxy to shizuha-home-backend')
}
