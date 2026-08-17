/**
 * Spoken Live harness — the agent talks like a human into the real mic path.
 *
 * Chrome fake-device is a 440 Hz beep. We replace getUserMedia with an
 * AudioContext destination and play Grok TTS of the operator's words into
 * it, with mid-clause silences, fillers, and mute. STT, hangover, and Ena
 * see the same path a human call uses.
 *
 * Conversation assertions read ONLY the mini-chat bubbles (and the HUD
 * caption / compose as early STT signals). Never the dashboard or sidebar.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import {
  authHeaders,
  bearerToken,
  homeCompose,
  hudState,
  liveAgentUsername,
  selectHomeAgent,
  shot,
  waitHudLeavesSpeaking,
} from './live-operator.js'

export const GHOST_LINE = /^(replied\.?|keyterms?\s*:|hive[.!?]?|pulse[.!?]?|cortex[.!?]?|shizuha[.!?]?)$/i
export const ACK_ONLY = /^(replied|done|sent|ok|okay|noted|here|pong)[.!]?$/i
export const SECRET_LEAK = /github_pat_|ghp_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{12,}|BEGIN (OPENSSH|RSA|EC) PRIVATE|-----BEGIN /

const asRe = (pattern) => (pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'))

export function addedTalk(previous, current) {
  const prev = String(previous || '')
  const now = String(current || '')
  if (now.startsWith(prev)) return now.slice(prev.length)
  if (prev && now.includes(prev.slice(-80))) {
    const i = now.lastIndexOf(prev.slice(-80))
    return now.slice(i + 80)
  }
  return now
}

export async function installSpokenMic(page) {
  const ttsClicks = []
  page.on('websocket', (ws) => {
    if (!/\/voice\/api\/tts\/stream/.test(ws.url())) return
    let prevLast = 0
    let havePrev = false
    ws.on('framereceived', (event) => {
      const raw = typeof event.payload === 'string' ? event.payload : ''
      if (!raw.startsWith('{')) return
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      if (msg.type !== 'audio.delta' || !msg.delta) return
      const mime = String(msg.mime || '')
      if (!/pcm|l16|raw/i.test(mime) && msg.provider !== 'grok') return
      try {
        const bin = atob(msg.delta)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        if (bytes.length < 4) return
        const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
        if (havePrev) {
          const jump = Math.abs(samples[0] - prevLast) / 32768
          if (jump > 0.55) ttsClicks.push(jump)
        }
        prevLast = samples[samples.length - 1]
        havePrev = true
      } catch { /* ignore malformed delta */ }
    })
  })

  await page.addInitScript(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioCtx({ sampleRate: 16000 })
    const silent = ctx.createGain()
    silent.gain.value = 0
    const osc = ctx.createOscillator()
    osc.frequency.value = 1
    osc.connect(silent)
    try { osc.start() } catch { /* already started */ }
    const attachDest = () => {
      const dest = ctx.createMediaStreamDestination()
      silent.connect(dest)
      return dest
    }
    let dest = attachDest()
    window.__shizuhaSpeak = {
      ctx,
      get dest() { return dest },
      clicks: [],
      async resume() {
        if (ctx.state === 'suspended') await ctx.resume()
      },
      async playDecoded(audioBuffer) {
        const src = ctx.createBufferSource()
        const gain = ctx.createGain()
        gain.gain.value = 1.4
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
        const live = dest.stream.getAudioTracks().some((track) => track.readyState === 'live')
        if (!live) dest = attachDest()
        return dest.stream
      }
      return orig(constraints)
    }
  })

  return {
    clicks: ttsClicks,
    resetClicks() { ttsClicks.length = 0 },
  }
}

export async function waitUntilListening(page, timeout = 20000) {
  await expect.poll(async () => {
    const now = await hudState(page)
    if (now.state === 'error') throw new Error(`Live error while waiting to listen: ${now.label}`)
    if (/^Muted$/i.test(now.label)) return false
    return now.state === 'listening' || /^listening/i.test(now.label)
  }, { timeout }).toBeTruthy()
}

export async function startSpokenLive(page) {
  if (!page.url().includes('/c/')) {
    await selectHomeAgent(page, liveAgentUsername())
  }
  await page.getByTestId('thread-live-button').click()
  const hud = page.getByTestId('live-voice-overlay')
  await expect(hud).toBeVisible({ timeout: 20000 })
  await page.evaluate(async () => {
    await window.__shizuhaSpeak?.resume?.()
  })
  const state = await hudState(page)
  if (state.state === 'error') {
    const err = await page.getByTestId('voice-call-error').textContent().catch(() => state.label)
    throw new Error(`Live failed to start: ${err || 'unknown voice error'}`)
  }
  await expect.poll(async () => (await hudState(page)).state, { timeout: 20000 })
    .not.toBe('idle')
  await waitUntilListening(page, 20000).catch(() => {})
  await waitForMiniChatStable(page)
  await page.waitForTimeout(400)
  return hud
}

export async function hudCaption(page) {
  return page.evaluate(() => {
    const labeled = document.querySelector('[data-testid="live-hud-caption"]')
    if (labeled) return (labeled.textContent || '').trim()
    const hud = document.querySelector('[data-testid="live-voice-overlay"]')
    const p = hud?.querySelector('p')
    return (p?.textContent || '').trim()
  })
}

export async function composeValue(page) {
  const box = homeCompose(page)
  if (!(await box.count())) return ''
  return box.inputValue().catch(() => '')
}

export async function miniChatTurns(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="mini-chat-scroll"]')
      || document.querySelector('[data-testid="connect-message-list"]')
    if (!root) return []
    const nodes = root.querySelectorAll('.flex.justify-end, .flex.justify-start')
    return [...nodes].map((row) => {
      const mine = /\bjustify-end\b/.test(row.className)
      const raw = (row.innerText || '').trim()
      const text = raw.replace(/^[A-Za-z][A-Za-z0-9 ._-]{0,24}:\s*/, '')
      return { role: mine ? 'user' : 'agent', text, raw }
    }).filter((row) => (
      row.text
      && !/Say something —|Loading conversation/i.test(row.text)
      && !/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(row.text)
      && !/^(EQ|YU|Ena QA)$/i.test(row.text)
    ))
  })
}

export async function talkText(page) {
  const turns = await miniChatTurns(page)
  return turns.map((row) => `${row.role}: ${row.text}`).join('\n')
}

export function parseTurns(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)
  const user = []
  const agent = []
  for (const line of lines) {
    if (GHOST_LINE.test(line)) continue
    const labeled = line.match(/^(?:user|agent|ena):\s*(.*)$/i)
    if (labeled) {
      const body = labeled[1]
      if (/^user:/i.test(line)) user.push(body)
      else if (body) agent.push(body)
      continue
    }
    const ena = line.match(/^(?:Ena QA|Ena|Yuna):\s*(.*)$/i)
    if (ena) {
      if (ena[1]) agent.push(ena[1])
      continue
    }
    if (/^live-qa /i.test(line)) continue
    user.push(line)
  }
  return { user, agent, lines }
}

function countRoleTexts(turns, role) {
  const counts = new Map()
  for (const row of turns) {
    if (row.role !== role) continue
    counts.set(row.text, (counts.get(row.text) || 0) + 1)
  }
  return counts
}

function newTurnsForRole(before, now, role) {
  const previous = countRoleTexts(before, role)
  const seen = new Map()
  const added = []
  for (const row of now) {
    if (row.role !== role) continue
    const n = (seen.get(row.text) || 0) + 1
    seen.set(row.text, n)
    if (n > (previous.get(row.text) || 0)) added.push(row)
  }
  return added
}

export function newUserTurns(before, now) {
  return newTurnsForRole(before, now, 'user')
}

/** After she talks, silence must not invent a user bubble. */
export async function assertNoPhantomUserTurns(page, before, waitMs = 8000) {
  await page.waitForTimeout(waitMs)
  const after = await miniChatTurns(page)
  const extra = newUserTurns(before, after)
  expect(extra, `phantom user turns: ${JSON.stringify(extra.map((r) => r.text))}`).toEqual([])
  return after
}

function newAgentTurns(before, now) {
  return newTurnsForRole(before, now, 'agent')
}

export async function waitForMiniChatStable(page, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last = -1
  let stableSince = 0
  while (Date.now() < deadline) {
    const loading = await page.getByTestId('mini-chat-scroll').getByText('Loading conversation').count().catch(() => 0)
    const turns = await miniChatTurns(page)
    if (!loading && turns.length === last && last >= 0) {
      if (!stableSince) stableSince = Date.now()
      if (Date.now() - stableSince >= 1500) return turns
    } else {
      stableSince = 0
      last = turns.length
    }
    await page.waitForTimeout(250)
  }
  return miniChatTurns(page)
}

export async function waitForStt(page, pattern, timeout = 20000) {
  const re = asRe(pattern)
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    const caption = await hudCaption(page)
    const typed = await composeValue(page)
    last = `${caption} | ${typed}`
    if (re.test(caption) || re.test(typed)) return { caption, typed }
    await page.waitForTimeout(250)
  }
  throw new Error(`STT never showed ${re}\nlast=${last}`)
}

export async function waitForNewUserTurn(page, beforeTurns, pattern, timeout = 25000) {
  const re = pattern ? asRe(pattern) : /./
  const deadline = Date.now() + timeout
  let last = beforeTurns
  while (Date.now() < deadline) {
    let now = await miniChatTurns(page)
    last = now
    let added = newUserTurns(beforeTurns, now)
    const hit = added.find((row) => re.test(row.text))
    if (hit) {
      const extraUntil = Date.now() + 2200
      while (Date.now() < extraUntil) {
        await page.waitForTimeout(350)
        const later = await miniChatTurns(page)
        const more = newUserTurns(beforeTurns, later)
        if (more.length >= added.length) {
          added = more
          now = later
          last = later
        }
      }
      const matched = [...added].reverse().find((row) => re.test(row.text)) || hit
      return { turn: matched, turns: now, added }
    }
    await page.waitForTimeout(350)
  }
  const dump = last.map((row) => `${row.role}: ${row.text}`).join('\n')
  throw new Error(`no new user turn matching ${re}\n${dump.slice(-1500)}`)
}

export async function waitForNewSpeech(page, previousText, pattern, timeout = 25000) {
  const before = String(previousText || '')
  const re = asRe(pattern)
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    last = await talkText(page)
    const added = addedTalk(before, last)
    if (re.test(added)) return { text: last, added }
    await page.waitForTimeout(400)
  }
  throw new Error(`never heard new speech matching ${re}\nadded=${addedTalk(before, last).slice(-800)}\n${last.slice(-1200)}`)
}

export async function waitForUserSpeech(page, pattern, timeout = 25000) {
  const previous = await talkText(page)
  return waitForNewSpeech(page, previous, pattern, timeout)
}

export async function waitForAgentAfter(page, beforeTurns, timeout = 120000) {
  const deadline = Date.now() + timeout
  let last = beforeTurns
  while (Date.now() < deadline) {
    const now = await miniChatTurns(page)
    last = now
    const users = newUserTurns(beforeTurns, now)
    const lastUser = users[users.length - 1]
    let reply = null
    if (lastUser) {
      const userIdx = now.reduce((idx, row, i) => (
        row.role === 'user' && row.text === lastUser.text ? i : idx
      ), -1)
      reply = now.slice(Math.max(0, userIdx) + 1).find((row) => (
        row.role === 'agent'
        && row.text.length > 2
        && !GHOST_LINE.test(row.text)
        && !ACK_ONLY.test(row.text)
      ))
    }
    if (!reply) {
      reply = newAgentTurns(beforeTurns, now).find((row) => (
        row.text.length > 2
        && !GHOST_LINE.test(row.text)
        && !ACK_ONLY.test(row.text)
      ))
    }
    if (reply) return { reply: reply.text, turn: reply, turns: now }
    await page.waitForTimeout(500)
  }
  const dump = last.map((row) => `${row.role}: ${row.text}`).join('\n')
  throw new Error(`no agent reply after spoken turn\n${dump.slice(-1500)}`)
}

export function assertSafeReply(text, where) {
  expect(text, `${where}: leaked a secret`).not.toMatch(SECRET_LEAK)
  expect(text, `${where}: ack-only leftover`).not.toMatch(ACK_ONLY)
  expect(text, `${where}: STT keyterm dump`).not.toMatch(/^keyterms?\s*:/i)
  expect(text, `${where}: ghost leftover`).not.toMatch(GHOST_LINE)
}

export async function expectNoGhostsInTalk(page, where) {
  const turns = await miniChatTurns(page)
  const ghosts = turns.filter((row) => GHOST_LINE.test(row.text) || /^keyterms?\s*:/i.test(row.text))
  expect(ghosts.map((row) => row.text), `${where}: ghost leftover`).toEqual([])
}

function toScript(input) {
  const list = Array.isArray(input) ? input : [input]
  return list.map((part, i) => {
    if (typeof part === 'string') {
      return { say: part, gapAfterMs: i === list.length - 1 ? 0 : 900, speed: 0.95 }
    }
    return {
      say: String(part.say || '').trim(),
      gapAfterMs: part.gapAfterMs ?? (i === list.length - 1 ? 0 : 900),
      speed: part.speed ?? 0.95,
    }
  }).filter((part) => part.say)
}

export async function speakLikeHuman(page, input) {
  const script = toScript(input)
  if (!script.length) return
  const token = await bearerToken(page)
  const parts = []
  for (const part of script) {
    let lastErr = 'user TTS failed'
    let body = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await page.request.post('/voice/api/tts', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          data: { text: part.say, speed: part.speed || 0.95 },
        })
        if (res.ok()) {
          body = Buffer.from(await res.body())
          lastErr = ''
          break
        }
        lastErr = `user TTS failed ${res.status()}`
      } catch (err) {
        lastErr = String(err?.message || err)
      }
      await page.waitForTimeout(700 * (attempt + 1))
    }
    if (!body) throw new Error(lastErr)
    parts.push({ b64: body.toString('base64'), gap: part.gapAfterMs || 0 })
  }
  await page.evaluate(async ({ phrases }) => {
    const speak = window.__shizuhaSpeak
    if (!speak) throw new Error('spoken mic hook missing')
    await speak.resume()
    const decoded = []
    for (const part of phrases) {
      const binary = atob(part.b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      decoded.push({
        buf: await speak.ctx.decodeAudioData(bytes.buffer.slice(0)),
        gap: part.gap || 0,
      })
    }
    const rate = decoded[0].buf.sampleRate
    const lead = Math.round(0.35 * rate)
    const tail = Math.round(0.28 * rate)
    const gaps = decoded.map((part) => Math.round(((part.gap || 0) / 1000) * rate))
    const total = lead + tail + decoded.reduce((n, part, i) => n + part.buf.length + gaps[i], 0)
    const mixed = speak.ctx.createBuffer(1, Math.max(total, 1), rate)
    const out = mixed.getChannelData(0)
    let offset = lead
    decoded.forEach((part, i) => {
      out.set(part.buf.getChannelData(0), offset)
      offset += part.buf.length + gaps[i]
    })
    await speak.playDecoded(mixed)
  }, { phrases: parts })
}

export async function speakAsHuman(page, text, { pauseMsAfter = 350 } = {}) {
  await speakLikeHuman(page, [{ say: text, gapAfterMs: 0, speed: 0.95 }])
  if (pauseMsAfter) await page.waitForTimeout(pauseMsAfter)
}

export async function speakWithPauses(page, parts, gapMs = 800) {
  const script = parts.map((part, i) => ({
    say: typeof part === 'string' ? part : part.say,
    gapAfterMs: i === parts.length - 1 ? 0 : gapMs,
    speed: 0.95,
  }))
  await speakLikeHuman(page, script)
  await page.waitForTimeout(400)
}

export async function muteLive(page) {
  const btn = page.getByTestId('hud-mute-button').or(page.getByRole('button', { name: /^Mute$/ }))
  await btn.click()
  await expect(page.getByTestId('live-voice-state')).toHaveText(/Muted/i, { timeout: 5000 })
}

export async function unmuteLive(page) {
  await page.getByRole('button', { name: /^Unmute$/ }).click()
  await expect.poll(async () => (await hudState(page)).label, { timeout: 8000 })
    .not.toMatch(/^Muted$/i)
}

export async function endLiveIfOpen(page) {
  const end = page.getByRole('button', { name: 'End Live' }).first()
  if (await end.count()) await end.click().catch(() => {})
}

export async function snapshotSpoken(page, name, extra = {}) {
  const file = await shot(page, name)
  const hud = await hudState(page)
  const text = await talkText(page)
  const turns = await miniChatTurns(page)
  const caption = await hudCaption(page)
  return { file, hud, text, turns, caption, ...extra }
}

export async function dumpSpokenFailure(page, name) {
  const snap = await snapshotSpoken(page, name)
  const dir = path.join(process.cwd(), 'test-results', 'live-operator')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({
    hud: snap.hud,
    caption: snap.caption,
    turns: snap.turns,
  }, null, 2))
  return snap
}

/**
 * One realistic spoken turn: snapshot → talk → (optional mute) → user bubble → agent reply.
 */
export async function spokenTurn(page, {
  name,
  script,
  hear,
  hearAll = [],
  topic,
  muteAfter = false,
  agentTimeout = 120000,
  allowShortAgent = false,
} = {}) {
  await waitUntilListening(page, 20000)
  const before = await miniChatTurns(page)
  await speakLikeHuman(page, script)
  if (muteAfter) await muteLive(page)
  if (hear) {
    await waitForStt(page, hear, 20000).catch(() => {})
  }
  const heard = await waitForNewUserTurn(page, before, hear || /./, 28000)
  const matched = heard.added.filter((row) => !hear || asRe(hear).test(row.text))
  const blob = (matched.length ? matched : heard.added).map((row) => row.text).join(' ')
  if (hear) expect(blob, `${name}: STT missed the utterance (${blob})`).toMatch(asRe(hear))
  for (const extra of hearAll) {
    expect(blob, `${name}: dropped clause ${extra} in "${blob}"`).toMatch(asRe(extra))
  }
  expect(blob, `${name}: heard as Nawa`).not.toMatch(/\bNawa\b/i)
  const agent = await waitForAgentAfter(page, before, agentTimeout)
  if (!allowShortAgent) {
    expect(agent.reply.length, `${name}: agent reply too short: ${agent.reply}`).toBeGreaterThan(8)
  }
  assertSafeReply(agent.reply, name)
  if (topic) {
    expect(agent.reply, `${name}: agent ignored the topic`).toMatch(asRe(topic))
  }
  await expectNoGhostsInTalk(page, name)
  console.log(`[spoken] ${name}\n  heard: ${blob}\n  reply: ${agent.reply.slice(0, 220)}`)
  return { heard: blob, reply: agent.reply, turns: agent.turns }
}

export { waitHudLeavesSpeaking, authHeaders }
