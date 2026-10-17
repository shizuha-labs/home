/** Deployment-owned live QA identities; no private conversation is bundled. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const KNOWN_THREAD = process.env.SHIZUHA_LIVE_THREAD || ''
export const LIVE_QA_AGENT = 'qa-agent'
export function expectedLiveQaUsername() {
  return process.env.SHIZUHA_LIVE_QA_EXPECTED_USER || 'liveqa'
}
export function isExpectedLiveQaUsername(user) {
  return String(user || '').toLowerCase() === expectedLiveQaUsername().toLowerCase()
}

function readCredFile(credPath) {
  try {
    const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (lines[0] && lines[1]) return { user: lines[0], pass: lines[1] }
  } catch {
    /* missing file is a skip, not a leak */
  }
  return { user: '', pass: '' }
}

export function loadLiveQaCreds() {
  const user = process.env.LIVE_QA_USER
  const pass = process.env.LIVE_QA_PASS
  if (user && pass && isExpectedLiveQaUsername(user)) return { user, pass }
  const credPath = process.env.SHIZUHA_LIVE_QA_CREDS
    || path.join(os.homedir(), '.shizuha', 'live-qa-creds')
  const fromFile = readCredFile(credPath)
  if (fromFile.user && fromFile.pass && isExpectedLiveQaUsername(fromFile.user)) return fromFile
  return { user: '', pass: '' }
}

export function loadOperatorCreds() {
  const user = process.env.SHIZUHA_LIVE_OPERATOR_USER || process.env.HRITIK_USER
  const pass = process.env.SHIZUHA_LIVE_OPERATOR_PASS || process.env.HRITIK_PASS
  if (user && pass) return { user, pass }
  const credPath = process.env.SHIZUHA_OPERATOR_CREDS
    || path.join(os.homedir(), '.shizuha', 'operator-ui-creds')
  return readCredFile(credPath)
}

export function loadLiveCallerCreds() {
  if (process.env.SHIZUHA_LIVE_OPERATOR_E2E === '1') return loadOperatorCreds()
  return loadLiveQaCreds()
}


export function liveAgentUsername() {
  if (process.env.SHIZUHA_LIVE_OPERATOR_E2E === '1') {
    const agent = process.env.SHIZUHA_LIVE_AGENT
    if (!agent) throw new Error('Set SHIZUHA_LIVE_AGENT for explicitly enabled operator tests')
    return agent
  }
  return process.env.SHIZUHA_LIVE_QA_AGENT || LIVE_QA_AGENT
}
