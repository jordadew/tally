// tally spur          the popup: title intro, then the prompt; s snooze, d done (r replays, m mutes)
// tally spur test     the same popup, recording nothing; q closes
// tally spur check    decide whether this moment should open Spur (--why prints the reason; --dry writes nothing)
// tally spur focus "SHIP THE APP"   set the prompt (checked against the rules in font.mjs)
// tally spur setup    first time: one question per screen; then status (e edit · t test). --edit opens edit, --again setup
// tally spur sounds   fetch the sounds from their sources and build them here (needs ffmpeg)
// tally spur install  add the Claude Code prompt hook that runs check (uninstall removes it)
// SPUR_FRAME=<s> [SPUR_DONE=<s>] tally spur test   print one frame and exit
import { existsSync, readFileSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { readMetric } from '../src/sources.mjs'
import { title, SETTLED } from './art.mjs'
import { doneFrame } from './done.mjs'
import { block, promptLines, focusProblem } from './font.mjs'
import { settings, store, decide, isDone } from './state.mjs'

const B = '\x1b[1m', R = '\x1b[0m', MIN = 60_000
const vlen = s => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length
const sp = n => ' '.repeat(Math.max(0, n))
export const soundDir = () => join(process.env.XDG_DATA_HOME || join(process.env.HOME, '.local', 'share'), 'tally', 'spur', 'sounds')

// Sounds come from `tally spur sounds`; until then Spur is silent. afplay on macOS; elsewhere ffplay
// (part of ffmpeg, which built the sounds).
let player = null
export function playSound(name) {
  const file = join(soundDir(), `${name}.mp3`)
  if (!existsSync(file)) return null
  const [bin, ...args] = process.platform === 'darwin' ? ['afplay'] : ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet']
  try { player = spawn(bin, [...args, file], { detached: true, stdio: 'ignore' }); player.on('error', () => {}); player.unref(); return player } catch { return null }
}

// Open the popup where you are: a herdr plugin pane, or a tmux popup.
function openPopup(path) {
  const bin = new URL('../bin/tally.mjs', import.meta.url).pathname
  if (process.env.HERDR_PANE_ID) return spawn('herdr', ['plugin', 'pane', 'open', '--plugin', 'tally', '--entrypoint', 'spur', '--env', `TALLY_CONFIG=${path}`], { detached: true, stdio: 'ignore' }).unref()
  if (process.env.TMUX) return spawn('tmux', ['display-popup', '-E', '-w', '62', '-h', '24', `node '${bin}' spur --config '${path}'`], { detached: true, stdio: 'ignore' }).unref()
}
export const stopSound = () => { try { player?.kill() } catch {} }

// Is the day's thing done, by the config's done metric? false when there's no metric or it errors.
async function doneByMetric(cfg, s, ctx) {
  if (!s.done || !cfg.metrics[s.done]) return false
  try { return isDone(await readMetric(cfg.metrics[s.done], ctx)) } catch { return false }
}

export async function run({ cmd, argv, cfg, path, ctx }) {
  const now = ctx.now, s = settings(cfg), st = store()
  const alive = () => { try { process.kill(Number(readFileSync(st.LOCK, 'utf8')), 0); return true } catch { return false } }

  // ---------------------------------------------------------------- focus
  if (cmd === 'focus') {
    const text = argv.slice(argv.indexOf('focus') + 1).filter(a => !a.startsWith('--')).join(' ').trim()
    const problem = focusProblem(text)
    if (problem) { console.error(`Not saved: ${problem}`); process.exit(1) }
    const raw = JSON.parse(readFileSync(path, 'utf8')), prompt = text.replace(/\s+/g, ' ').toUpperCase()
    copyFileSync(path, `${path}.bak`)
    writeFileSync(path, JSON.stringify({ ...raw, spur: { ...(raw.spur ?? {}), prompt } }, null, 2) + '\n')
    console.log(`Spur prompt: ${prompt}\n${promptLines(prompt).flatMap(block).join('\n')}`)
    return
  }

  // ---------------------------------------------------------------- setup
  if (cmd === 'setup') { const { setup } = await import('./setup.mjs'); await setup({ cfg, path, ctx, argv }); return }

  // ---------------------------------------------------------------- sounds, install
  if (cmd === 'sounds') {
    const { buildSounds } = await import('./sounds.mjs')
    console.log(`Building Spur's sounds in ${soundDir()} (downloaded from Freesound and Mixkit; credits in spur/CREDITS.md)`)
    try { await buildSounds(soundDir()) } catch (e) { console.error(e.message); process.exit(1) }
    console.log('Done. Try them: tally spur test')
    return
  }
  if (cmd === 'install' || cmd === 'uninstall') {
    const { install } = await import('./install.mjs')
    await install(path, { remove: cmd === 'uninstall', yes: argv.includes('--yes') })
    return
  }

  // ---------------------------------------------------------------- check
  if (cmd === 'check') {
    const dry = argv.includes('--dry'), why = r => { if (argv.includes('--why')) console.log(r) }
    let day = st.workDay(now, s)
    if (day.fresh) day = { dayStart: now.toISOString() }
    if (!dry) st.writeNudge({ ...day, lastPrompt: now.toISOString() })
    const r = decide({ now, s, day, open: alive(), doneToday: s.on && s.prompt ? await doneByMetric(cfg, s, ctx) : false })
    if (r === 'due' && !dry) openPopup(path)
    why(r === 'due' && !dry ? 'opened' : r)
    return r
  }

  // ---------------------------------------------------------------- popup
  const TEST = cmd === 'test'
  if (!s.prompt) { console.error('Spur has no prompt yet. Run: tally spur focus "SHIP THE APP" (or tally spur setup)'); process.exit(1) }
  if (!TEST) { mkdirSync(st.dir, { recursive: true }); writeFileSync(st.LOCK, String(process.pid)) }
  const quit = () => { process.stdout.write(`\x1b[?25h${R}`); process.exit(0) }
  process.on('exit', () => { try { if (readFileSync(st.LOCK, 'utf8') === String(process.pid)) rmSync(st.LOCK) } catch {} })
  for (const sig of ['SIGHUP', 'SIGTERM']) process.on(sig, () => process.exit(0))
  process.stdout.write('\x1b[?25l\x1b[2J')

  // No sound in quiet hours (22:00–08:00) except in the test popup.
  const quiet = now.getHours() < 8 || now.getHours() >= 22
  let muted = st.prefs().muted
  const audible = () => !muted && (TEST || !quiet) && !process.env.SPUR_FRAME
  const start = () => { if (audible()) playSound('spur'); return Date.now() }
  let t0 = start()
  const PW = process.stdout.columns || 59, ROWS = process.stdout.rows || 22 // the popup's inner size
  const OUT = SETTLED, IN = SETTLED + 0.3, SHOWN = SETTLED + 0.65

  const rgbc = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`
  const fade = (str, f) => str.replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, (_, r, g, b) => `\x1b[38;2;${(r * f) | 0};${(g * f) | 0};${(b * f) | 0}m`)
  const WH = rgbc([242, 242, 242]), GR = rgbc([150, 150, 150]), RD = rgbc([232, 96, 86]), AM = rgbc([240, 172, 96])
  const center = str => sp(Math.floor((PW - vlen(str)) / 2)) + str

  // The count: the config's "since" metric (days), else days since the last d for this prompt.
  let days = null
  const loaded = (async () => {
    if (s.since && cfg.metrics[s.since]) { try { const v = await readMetric(cfg.metrics[s.since], ctx); days = typeof v === 'number' ? v : null } catch {} }
    if (days == null) days = st.lastDone(now, s.prompt)
  })()
  let ready = false
  loaded.then(() => { ready = true })
  const snoozes = st.snoozesToday(now, s)
  const needReason = s.reasonFrom > 0 && snoozes.length + 1 >= s.reasonFrom
  let reason = null, done = false, doneAt = 0, pageTop = 0
  const hhmm = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const page = () => {
    // done today or yesterday: no line; 2 days: a quiet note; 3+: the red count
    const gap = days == null || days <= 1 ? '' : days < 3 ? `${GR}Last done ${days} days ago${R}`
      : `${GR}Day ${R}${RD}${B}${days}${R}${GR} since last done${R}`
    const prompt = promptLines(s.prompt).map(l => block(l).map(r => center(`${WH}${B}${r}${R}`)))
    const lines = [...prompt.flatMap((b, i) => (i ? ['', ...b] : b)), ...(gap ? ['', center(gap)] : [])]
    if (snoozes.length) lines.push('', '',
      center(`${AM}${'●'.repeat(snoozes.length)}${R}`), center(`${AM}Snooze ${snoozes.length}×${R}`), '', // a breath before the times
      ...snoozes.slice(-4).map(x => center(`${GR}${hhmm(x.at)}${R}${x.reason ? `  ${WH}\x1b[3m“${x.reason}”${R}` : ''}`)))
    const foot = reason == null
      ? ['', center([['s', 'snooze'], ['d', 'done']].map(([k, l]) => `${WH}${B}${k}${R}  ${GR}${l}${R}`).join('    '))]
      : [center(`${AM}Why snooze?${R} ${WH}${reason}${AM}▏${R}`), center(`${GR}enter to snooze · delete all to go back${R}`)]
    const space = ROWS - 2, top = Math.max(0, Math.floor((space - lines.length) / 2))
    pageTop = top
    return [...Array(top).fill(''), ...lines, ...Array(Math.max(0, space - top - lines.length)).fill(''), ...foot]
  }
  const doneView = () => {
    const before = ready ? page() : [], n = promptLines(s.prompt).length * 4 - 1
    const { lines, kf, at } = doneFrame((Date.now() - doneAt) / 1000, { W: PW, H: ROWS, prompt: promptLines(s.prompt), top: pageTop })
    const promptRow = i => (i >= pageTop && i < pageTop + n) || (i >= at && i < at + n)
    return lines.map((l, i) => (kf > 0 && !promptRow(i) && before[i]?.trim() ? fade(before[i], kf) : l))
  }

  let anim = null
  const frame = () => {
    const t = (Date.now() - t0) / 1000
    let lines
    if (done) lines = doneView()
    else if (t < IN) { // the intro, centred, fading out once it lands
      const f = t < OUT ? 1 : Math.max(0, 1 - (t - OUT) / (IN - OUT))
      const shift = Math.floor((ROWS - 10) / 2) - 8, art = title(t)
      lines = (shift < 0 ? art.slice(-shift) : [...Array(shift).fill(''), ...art]).map(l => sp(Math.floor((PW - 58) / 2)) + fade(l, f))
    } else if (!ready) lines = []
    else lines = page().map(l => fade(l, Math.min(1, (t - IN) / (SHOWN - IN))))
    process.stdout.write(`\x1b[H${lines.map(l => `${l}\x1b[K`).join('\n')}\x1b[J`)
    if (t >= SHOWN && ready && !done) { clearInterval(anim); anim = null }
  }
  if (process.env.SPUR_FRAME) {
    await loaded; Date.now = (n => () => n)(t0 + Number(process.env.SPUR_FRAME) * 1000)
    if (process.env.SPUR_DONE) { done = true; doneAt = Date.now() - Number(process.env.SPUR_DONE) * 1000 }
    frame(); process.exit(0)
  }
  anim = setInterval(frame, 33)
  const redraw = () => { if (!anim) frame() }

  const finish = () => { // done for today: the done screen and sound, remember it, close
    done = true; doneAt = Date.now()
    const p = audible() ? (stopSound(), playSound('done')) : null
    if (!TEST) st.writeNudge({ ...st.readNudge(), done: true })
    clearInterval(watch); clearInterval(anim); anim = setInterval(frame, 33)
    // close once DONE has held (3s) and the sound has ended, whichever is later; 6s at most
    let held = false, ended = !p
    const close = () => { if (held && ended) quit() }
    p?.on('exit', () => { ended = true; close() })
    setTimeout(() => { held = true; close() }, 3000)
    setTimeout(quit, 6000)
  }
  // While open, check the done metric every minute and close on its own once it says done.
  const watch = s.done ? setInterval(async () => { if (!done && (await doneByMetric(cfg, s, ctx))) finish() }, 60_000) : null

  const snooze = text => {
    if (TEST) quit()
    const t = new Date()
    st.addSnooze(t, text)
    st.writeNudge({ ...st.readNudge(), until: new Date(t.getTime() + s.snooze * MIN).toISOString(), kind: 'snooze' })
    quit()
  }
  process.stdin.setRawMode(true)
  process.stdin.resume()
  const opened = Date.now(), lock = (SHOWN - 0.2) * 1000 // keys wait until the page is in
  process.stdin.on('data', b => {
    const key = b.toString()
    if (key === '\x03') quit()
    if (Date.now() - opened < lock || done) return
    if (reason != null) {
      if (key === '\x1b') reason = null
      else if (key === '\r') { if (reason.trim()) snooze(reason.trim()) }
      else if (key === '\x7f') reason = reason ? reason.slice(0, -1) : null
      else if (key >= ' ' && !key.startsWith('\x1b')) reason = (reason + key).slice(0, 40)
      return redraw()
    }
    if (TEST && (key === 'q' || key === 'Q')) quit()
    if (key === 'm' || key === 'M') { muted = !muted; if (muted) stopSound(); st.savePrefs({ ...st.prefs(), muted }); return redraw() }
    if (key === 'r' || key === 'R') { t0 = start(); clearInterval(anim); anim = setInterval(frame, 33); return }
    if (key === 'd' || key === 'D') { if (!TEST) st.addDone(new Date(), s.prompt); return finish() }
    if (key === 's' || key === 'S') { if (needReason) { reason = ''; redraw() } else snooze(null) }
  })
}
