/**
 * Human Live conversation with Hina on shizuha.com.
 *
 * Real Chromium, human mouse paths, TTS into the mic, then STT both
 * sides from live-trace + Connect. This is the Hina S2S QA bar — a
 * socket/HUD check is not enough.
 *
 *   SHIZUHA_LIVE_OPERATOR_E2E=1 node tests/e2e/live-hina-human-conversation.mjs
 *
 * Optional: HEADED=1 DISPLAY=:0 XAUTHORITY=... for a visible window.
 * Never prints passwords. Never clicks the speaker chip or live-trace
 * mid-sentence.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const OUT = process.env.OUT_DIR || '/mnt/ramdisk/agent-scratch/hina-human-out'
fs.mkdirSync(OUT, { recursive: true })

const TURNS = [
  "Yo, what's up?",
  'Tell me more about yourself.',
  'What can you do on a normal day?',
  'Do I have any tasks I should know about?',
  'Thanks. Say one short sentence about Pulse.',
  'Okay, what about Connect chat?',
  'Can you hear the start and end of this sentence clearly?',
  'Great. Wrap up in one short goodbye.',
]

function creds() {
  const p = process.env.SHIZUHA_OPERATOR_CREDS
    || path.join(os.homedir(), '.shizuha', 'operator-ui-creds')
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (!lines[0] || !lines[1]) throw new Error('operator-ui-creds missing')
  return { user: lines[0], pass: lines[1] }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms + Math.floor(Math.random() * 180)))
}

async function humanClick(page, locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('control not visible')
  const x = box.x + box.width * (0.35 + Math.random() * 0.3)
  const y = box.y + box.height * (0.35 + Math.random() * 0.3)
  await page.mouse.move(x - 48 - Math.random() * 24, y - 18 - Math.random() * 16, { steps: 10 })
  await sleep(70 + Math.random() * 80)
  await page.mouse.move(x, y, { steps: 14 })
  await sleep(80 + Math.random() * 70)
  await page.mouse.down()
  await sleep(35 + Math.random() * 30)
  await page.mouse.up()
}

async function installMic(page) {
  await page.addInitScript(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioCtx({ sampleRate: 24000 })
    const silent = ctx.createGain()
    silent.gain.value = 0
    const dest = ctx.createMediaStreamDestination()
    silent.connect(dest)
    window.__shizuhaSpeak = {
      ctx,
      dest,
      async resume() { if (ctx.state === 'suspended') await ctx.resume() },
      async playDecoded(audioBuffer) {
        const src = ctx.createBufferSource()
        const gain = ctx.createGain()
        gain.gain.value = 1.25
        src.buffer = audioBuffer
        src.connect(gain)
        gain.connect(dest)
        src.start()
        await new Promise((resolve) => { src.onended = resolve })
      },
    }
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        if (ctx.state === 'suspended') await ctx.resume()
        return dest.stream
      }
      return orig(constraints)
    }
  })
}

async function speak(page, text, token) {
  const res = await fetch('https://shizuha.com/voice/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, speed: 0.95 }),
  })
  if (!res.ok) throw new Error(`tts ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const b64 = buf.toString('base64')
  await page.evaluate(async (payload) => {
    const speakFn = window.__shizuhaSpeak
    await speakFn.resume()
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const decoded = await speakFn.ctx.decodeAudioData(bytes.buffer.slice(0))
    await speakFn.playDecoded(decoded)
  }, b64)
}

async function snapshot(page) {
  return page.evaluate(() => {
    const hud = document.querySelector('[data-testid="live-voice-overlay"]')
    const speak = window.__shizuhaSpeakOutput?.() || {}
    return {
      transport: hud?.getAttribute('data-transport') || '',
      state: hud?.getAttribute('data-call-state') || '',
      caption: (document.querySelector('[data-testid="live-hud-caption"]')?.textContent || '').trim(),
      remainingMs: speak.remainingMs || 0,
      muted: !!speak.muted,
    }
  })
}

function summarizeTrace(trace) {
  const events = (trace.events || []).map((e) => ({
    ts: e.ts,
    name: e.name,
    text: e.attrs?.text || e.attrs?.content || '',
    via: e.attrs?.via || '',
    type: e.attrs?.type || '',
  }))
  return {
    callId: trace.call_id || '',
    user: events.filter((e) => e.name === 's2s.user').map((e) => e.text).filter(Boolean),
    assistant: events.filter((e) => e.name === 's2s.assistant').map((e) => e.text).filter(Boolean),
    audioStarts: events.filter((e) => e.name === 's2s.audio.start').length,
    names: events.map((e) => e.name).filter(Boolean),
    events,
  }
}

async function main() {
  const { user, pass } = creds()
  const headed = process.env.HEADED === '1'
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,900',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  await installMic(page)
  const log = []

  await page.goto('https://shizuha.com/id/login?continue=/', { waitUntil: 'domcontentloaded' })
  await sleep(1100)
  if (page.url().includes('/id/login')) {
    await page.locator('#username').click()
    await page.keyboard.type(user, { delay: 45 + Math.floor(Math.random() * 30) })
    await sleep(350)
    await page.locator('#password').click()
    await page.keyboard.type(pass, { delay: 40 + Math.floor(Math.random() * 25) })
    await sleep(300)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/id/api/auth/login/') && r.request().method() === 'POST', { timeout: 30000 }),
      page.locator('button[type="submit"]').click(),
    ])
    await page.waitForURL((u) => !u.toString().includes('/id/login'), { timeout: 30000 })
  }
  await page.goto('https://shizuha.com/')
  await page.evaluate(() => localStorage.setItem('shizuha_home_agent', 'hina'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="home-live-button"]', { timeout: 20000 })
  await sleep(1400)
  await humanClick(page, page.locator('[data-testid="home-live-button"]'))
  await page.waitForSelector('[data-testid="live-voice-overlay"]', { timeout: 20000 })
  const readyAt = Date.now()
  let snap = await snapshot(page)
  while (Date.now() - readyAt < 12000 && snap.state !== 'listening') {
    await sleep(250)
    snap = await snapshot(page)
  }
  const token = await page.evaluate(() => localStorage.getItem('shizuha_access_token') || '')
  await page.screenshot({ path: path.join(OUT, '00-live-started.png'), fullPage: true })

  for (let i = 0; i < TURNS.length; i += 1) {
    const said = TURNS[i]
    await speak(page, said, token)
    const started = Date.now()
    snap = await snapshot(page)
    while (Date.now() - started < 32000) {
      snap = await snapshot(page)
      if ((snap.state === 'speaking' && snap.remainingMs > 60 && !snap.muted)
        || (snap.caption && snap.caption !== said && snap.state === 'speaking')) break
      await sleep(280)
    }
    const settle = Date.now()
    while (Date.now() - settle < 22000) {
      snap = await snapshot(page)
      if (snap.state !== 'speaking' && snap.remainingMs < 40) break
      await sleep(320)
    }
    await page.screenshot({ path: path.join(OUT, `${String(i + 1).padStart(2, '0')}-after-${i}.png`), fullPage: true })
    const row = {
      n: i + 1,
      said,
      heard_caption: snap.caption,
      state: snap.state,
      remainingMs: snap.remainingMs,
      muted: snap.muted,
    }
    log.push(row)
    fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify(log, null, 2))
    await sleep(900 + Math.random() * 700)
  }

  const trace = await page.evaluate(async () => {
    const access = localStorage.getItem('shizuha_access_token') || ''
    const res = await fetch('/api/home/live-trace?include_messages=1&limit=400', {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (!res.ok) return { ok: false, status: res.status }
    return res.json()
  })
  fs.writeFileSync(path.join(OUT, 'live-trace.json'), JSON.stringify(trace, null, 2))
  const summary = { turns: log, ...summarizeTrace(trace) }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  await page.locator('[aria-label="End Live"]').first().click({ force: true }).catch(() => {})
  await browser.close()
  if (!summary.assistant.length) process.exit(2)
}

main().catch((err) => {
  console.error(String(err && err.stack || err))
  process.exit(1)
})
