/**
 * Full-scale spoken Live suite. The agent must RUN this against production:
 *
 *   npm run test:e2e:live:spoken
 *
 * A fake-device beep is not a human. Each turn is synthesized speech injected
 * into getUserMedia so STT, mute, hangover, and Ena see the real path.
 *
 * Two serial conversations as liveqa → Ena QA (never the operator Ena thread):
 *   1. A realistic back-and-forth (greet, wiki how-to, mid-thought digits,
 *      mute-keeps-turn, self-correction, wiki stitch, wrap-up).
 *   2. Edge gauntlet: mute-keeps-turn, mute is silence-only, unmute resume,
 *      name, spoken digits, talk-over, leftover ghosts, TTS click detector.
 *
 * Credentials: ~/.shizuha/live-qa-creds. Never commit or print the password.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { loadLiveQaCreds, loginHome, assertSidebarHasNoGhosts, hudState } from './live-operator.js'
import {
  installSpokenMic,
  startSpokenLive,
  speakLikeHuman,
  speakAsHuman,
  waitForStt,
  waitForNewUserTurn,
  waitForAgentAfter,
  expectNoGhostsInTalk,
  muteLive,
  unmuteLive,
  endLiveIfOpen,
  snapshotSpoken,
  dumpSpokenFailure,
  spokenTurn,
  miniChatTurns,
  talkText,
  waitHudLeavesSpeaking,
  waitUntilListening,
  assertSafeReply,
} from './live-spoken.js'

const STATE = path.join(os.tmpdir(), `shizuha-spoken-qa-${process.pid}.json`)
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
}

const LIVE = process.env.SHIZUHA_LIVE_E2E === '1' || process.env.SHIZUHA_LIVE_SPOKEN_E2E === '1'
const CREDS = loadLiveQaCreds()

test.skip(!LIVE, 'set SHIZUHA_LIVE_SPOKEN_E2E=1 (or SHIZUHA_LIVE_E2E=1) to run spoken Live QA')
test.skip(!CREDS.user || !CREDS.pass, 'spoken Live QA needs ~/.shizuha/live-qa-creds')
test.skip(/hritik/i.test(CREDS.user), 'spoken Live QA must not use the operator mailbox')

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

test.describe.configure({ mode: 'default' })

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  await loginHome(page)
  await context.storageState({ path: STATE })
  await context.close()
})

test.afterAll(() => {
  try { fs.unlinkSync(STATE) } catch { /* tmp */ }
})

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await dumpSpokenFailure(page, `fail-${info.title.replace(/[^\w]+/g, '-').slice(0, 48)}`)
  }
  await endLiveIfOpen(page)
})

test.use({ storageState: STATE })

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
function checkNumberWords() {
  const n = Date.now() % 100
  const spoken = `${ONES[Math.floor(n / 10)]} ${ONES[n % 10]}`
  return { n, spoken }
}

test('spoken Live: realistic multi-turn investigation as the test user', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000)
  const tts = await installSpokenMic(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('home-live-button')).toBeVisible({ timeout: 20000 })
  await startSpokenLive(page)
  await snapshotSpoken(page, 'spoken-inv-00-live-up')
  const tag = checkNumberWords()

  await test.step('greet Ena QA like a human, not Nawa', async () => {
    const turn = await spokenTurn(page, {
      name: 'greet',
      script: `Hey Ena, you there? This is a live check, number ${tag.spoken}. What's up?`,
      hear: new RegExp(`live check|number ${tag.spoken.replace(/\s+/g, '\\s+')}`, 'i'),
      agentTimeout: 90000,
    })
    expect(turn.heard, `heard as Nawa: ${turn.heard}`).not.toMatch(/\bNawa\b/i)
    expect(turn.heard, `did not hear Ena or the greeting: ${turn.heard}`).toMatch(/Ena|what's up|whats up|you there|live check/i)
    await waitHudLeavesSpeaking(page, 40000)
    await snapshotSpoken(page, 'spoken-inv-01-greet')
  })

  await test.step('ask her to look up the live HUD how-to on the wiki', async () => {
    await spokenTurn(page, {
      name: 'wiki-howto',
      script: [
        { say: 'Okay so I need you to look up', gapAfterMs: 700 },
        { say: 'the live voice HUD how-to on the wiki. Just tell me what page you found.', gapAfterMs: 0 },
      ],
      hear: /look|wiki|live|hud|how to|howto/i,
      hearAll: [/look|need|wiki/i, /hud|voice|how to|howto|page/i],
      topic: /wiki|hud|voice|live|page|how/i,
      agentTimeout: 120000,
    })
    await waitHudLeavesSpeaking(page, 60000)
    await snapshotSpoken(page, 'spoken-inv-02-wiki')
  })

  await test.step('mid-thought pause then spoken digits stay one turn', async () => {
    await spokenTurn(page, {
      name: 'check-number',
      script: [
        { say: 'I want you to check', gapAfterMs: 1100 },
        { say: 'this five nine three six check number and read it back.', gapAfterMs: 0 },
      ],
      hear: /check|five|nine|three|six|5936/i,
      hearAll: [/check|want/i, /five|nine|three|six|5936/i],
      topic: /five|nine|5936|check|number|six/i,
      agentTimeout: 120000,
    })
    await waitHudLeavesSpeaking(page, 60000)
    await snapshotSpoken(page, 'spoken-inv-03-digits')
  })

  await test.step('ask a follow-up then mute so the turn still sends', async () => {
    const turn = await spokenTurn(page, {
      name: 'follow-mute',
      script: 'Can you say that check number one more time, slowly?',
      hear: /check number|slowly|one more/i,
      topic: /five|nine|5936|check|number|six/i,
      muteAfter: true,
      agentTimeout: 120000,
    })
    await expect(page.getByTestId('live-voice-state')).toHaveText(/Muted/i)
    expect(turn.reply).not.toMatch(/^(replied|done|ok|here)[.!]?$/i)
    await unmuteLive(page)
    await waitUntilListening(page, 15000)
    await snapshotSpoken(page, 'spoken-inv-04-mute')
  })

  await test.step('self-correct mid sentence like a real caller', async () => {
    await spokenTurn(page, {
      name: 'self-correct',
      script: [
        { say: 'No wait, not the wiki page.', gapAfterMs: 650 },
        { say: 'I mean just say the word lantern if you can still hear me.', gapAfterMs: 0 },
      ],
      hear: /wait|wiki|lantern|hear/i,
      topic: /lantern|hear|okay|got it|here/i,
      agentTimeout: 90000,
      allowShortAgent: true,
    })
    await waitHudLeavesSpeaking(page, 60000)
    await snapshotSpoken(page, 'spoken-inv-05-correct')
  })

  await test.step('che-check stitch: unfinished word, then the wiki ask', async () => {
    await spokenTurn(page, {
      name: 'wiki-stitch',
      script: [
        { say: 'I want you to che', gapAfterMs: 1200 },
        { say: 'check the live HUD how-to title on the wiki. Do not invent a URL.', gapAfterMs: 0 },
      ],
      hear: /check|wiki|hud|how to|howto/i,
      topic: /wiki|hud|voice|live|page|how|title/i,
      agentTimeout: 120000,
    })
    await waitHudLeavesSpeaking(page, 60000)
    await snapshotSpoken(page, 'spoken-inv-06-wiki')
  })

  await test.step('wrap up and confirm she still hears us', async () => {
    const turn = await spokenTurn(page, {
      name: 'lantern-wrap',
      script: 'Okay that is enough for now. If you can still hear me, say the word lantern once.',
      hear: /enough|lantern|hear me/i,
      topic: /lantern|hear|okay|got it|here/i,
      agentTimeout: 90000,
      allowShortAgent: true,
    })
    expect(turn.reply.toLowerCase()).toMatch(/lantern|here|okay|got it|hear/)
    await expectNoGhostsInTalk(page, 'end of investigation')
    await assertSidebarHasNoGhosts(page)
    const bad = tts.clicks.filter((n) => n > 0.7)
    expect(bad.length, `TTS chunk clicks ${JSON.stringify(tts.clicks.slice(0, 12))}`).toBeLessThan(4)
    const hud = await waitHudLeavesSpeaking(page, 40000)
    expect(hud.stuck).toBeFalsy()
    await snapshotSpoken(page, 'spoken-inv-07-wrap')
  })
})

test('spoken Live: mute, unmute, leak, stitch, names, barge-in', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000)
  const tts = await installSpokenMic(page)
  const tag = checkNumberWords()
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await startSpokenLive(page)

  await test.step('Hey Ena must not become Nawa', async () => {
    const before = await miniChatTurns(page)
    await speakAsHuman(page, `Hey Ena, what's up? Edge check number ${tag.spoken}.`)
    const heard = await waitForNewUserTurn(page, before, /hey|ena|what's up|whats up|edge check/i, 30000)
    expect(heard.turn.text, `heard as Nawa: ${heard.turn.text}`).not.toMatch(/\bNawa\b/i)
    expect(heard.turn.text).toMatch(/Ena|what's up|whats up|what is up|edge check/i)
    const reply = await waitForAgentAfter(page, before, 90000)
    assertSafeReply(reply.reply, 'hey Ena')
    await waitHudLeavesSpeaking(page, 25000)
    await waitUntilListening(page, 15000)
    await snapshotSpoken(page, 'spoken-edge-01-ena')
  })

  await test.step('patient listener: mid-thought + spoken digits stay one turn', async () => {
    const before = await miniChatTurns(page)
    await speakLikeHuman(page, [
      { say: 'I want you to check', gapAfterMs: 1100 },
      { say: 'this five nine three six Pulse task', gapAfterMs: 0 },
    ])
    const heard = await waitForNewUserTurn(page, before, /check|five|nine|5936|pulse/i, 28000)
    const blob = heard.added.map((row) => row.text).join(' ')
    expect(blob, `clause dropped: ${blob}`).toMatch(/check|want/i)
    expect(blob, `digits dropped: ${blob}`).toMatch(/five|nine|three|six|5936|pulse|task/i)
    const reply = await waitForAgentAfter(page, before, 120000)
    expect(reply.reply.length).toBeGreaterThan(8)
    assertSafeReply(reply.reply, 'patient digits')
    await waitHudLeavesSpeaking(page, 40000)
    await waitUntilListening(page, 20000)
    await snapshotSpoken(page, 'spoken-edge-02-digits')
  })

  await test.step('speak then mute — mute must not drop the turn', async () => {
    const before = await miniChatTurns(page)
    await speakAsHuman(page, `Please read back check number ${tag.spoken} one more time.`)
    await waitForStt(page, /check number|read back|edge check|one more/i, 15000).catch(() => {})
    await muteLive(page)
    const heard = await waitForNewUserTurn(page, before, /check number|read back|one more|edge check/i, 25000)
    expect(heard.turn.text, 'mute dropped the utterance').toMatch(/check|read|number|more/i)
    const reply = await waitForAgentAfter(page, before, 120000)
    assertSafeReply(reply.reply, 'mute send')
    await expect(page.getByTestId('live-voice-state')).toHaveText(/Muted/i)
    await snapshotSpoken(page, 'spoken-edge-03-mute-kept')
    await unmuteLive(page)
    await waitUntilListening(page, 15000)
  })

  await test.step('muted speech must not leak; unmute hears the next sentence', async () => {
    await waitHudLeavesSpeaking(page, 40000).catch(() => {})
    await waitUntilListening(page, 15000)
    const beforeNote = await miniChatTurns(page)
    await speakAsHuman(page, `Ena, note that I am about to mute after this sentence. Marker ${tag.spoken}.`)
    await waitForStt(page, /mute after this|note that I am|marker/i, 15000).catch(() => {})
    await muteLive(page)
    await waitForNewUserTurn(page, beforeNote, /mute after this|note that I am|marker/i, 25000)
    const mutedTurns = await miniChatTurns(page)
    await speakAsHuman(page, 'You should not hear the word pineapple while I am muted.')
    await page.waitForTimeout(2800)
    const still = await talkText(page)
    expect(still, 'muted speech leaked into the thread').not.toMatch(/pineapple/i)
    void mutedTurns

    await unmuteLive(page)
    await waitUntilListening(page, 15000)
    const beforeBack = await miniChatTurns(page)
    await speakAsHuman(page, `Okay I am back. Please say the word lantern once. Marker ${tag.spoken}.`)
    const heard = await waitForNewUserTurn(page, beforeBack, /lantern|I am back|marker/i, 25000)
    const reply = await waitForAgentAfter(page, beforeBack, 90000)
    expect(reply.reply.toLowerCase()).toMatch(/lantern|here|okay|back/)
    await expectNoGhostsInTalk(page, 'unmute resume')
    await snapshotSpoken(page, 'spoken-edge-04-unmute')
  })

  await test.step('talk-over while she speaks must not kill the call; next listen still hears us', async () => {
    const before = await miniChatTurns(page)
    await speakAsHuman(page, 'Give me two short sentences on what we just talked about.')
    await waitForNewUserTurn(page, before, /two|short|talked|sentences/i, 25000)
    const started = Date.now()
    while (Date.now() - started < 25000) {
      const now = await hudState(page)
      if (now.state === 'speaking' || /^speaking/i.test(now.label)) break
      if (now.state === 'error') throw new Error(`Live died before talk-over: ${now.label}`)
      await page.waitForTimeout(200)
    }
    await speakAsHuman(page, 'Stop. Just say the word lantern.')
    const during = await hudState(page)
    expect(during.state, `call died during talk-over: ${during.state} ${during.label}`).not.toBe('error')
    await waitHudLeavesSpeaking(page, 90000).catch(() => {})
    await waitUntilListening(page, 45000)
    const beforeFast = await miniChatTurns(page)
    await speakAsHuman(page, 'Okay, just say lantern.')
    const heard = await waitForNewUserTurn(page, beforeFast, /lantern|okay/i, 25000)
    const reply = await waitForAgentAfter(page, beforeFast, 90000)
    assertSafeReply(reply.reply, 'fast follow-up')
    expect(heard.turn.text).toMatch(/lantern|okay/i)
    await snapshotSpoken(page, 'spoken-edge-05-barge')
  })

  await test.step('no leftover ghosts and TTS did not click mid-syllable', async () => {
    await expectNoGhostsInTalk(page, 'end of edge gauntlet')
    await assertSidebarHasNoGhosts(page)
    const bad = tts.clicks.filter((n) => n > 0.7)
    expect(bad.length, `TTS chunk clicks ${JSON.stringify(tts.clicks.slice(0, 12))}`).toBeLessThan(4)
    await snapshotSpoken(page, 'spoken-edge-06-end')
  })
})
