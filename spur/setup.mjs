// tally spur setup: the first time, Spur's settings one question per screen (sound stays on); after that a status screen
// (q back · e edit · t test) and an edit screen with every setting on one page. --edit opens edit, --again setup.
// Saves into the config's "spur" block (the old config is kept as .bak); mute is a per-machine pref.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { settings, store, pastCutoff, isDone, DEFAULTS } from './state.mjs'
import { focusProblem } from './font.mjs'
import { readMetric } from '../src/sources.mjs'

const B = '\x1b[1m', R = '\x1b[0m', MIN = 60_000
const vlen = s => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length
const sp = n => ' '.repeat(Math.max(0, n))
const rgbc = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`
const WH = rgbc([242, 242, 242]), GR = rgbc([150, 150, 150]), AM = rgbc([240, 172, 96]), GN = rgbc([120, 200, 120]), TN = rgbc([214, 168, 112]), RD = rgbc([232, 96, 86])
const hhmm = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const cap = t => t[0] + t.slice(1).toLowerCase()

// "Work it out with Claude": a Claude Code session running the /tally-setup skill's Spur part,
// in a new herdr tab or tmux window. Returns false if neither is here (setup then prints the command).
const CLAUDE = 'claude "/tally-setup spur"'
function discuss(cwd) {
  if (process.env.HERDR_PANE_ID) {
    const r = spawnSync('herdr', ['tab', 'create', '--focus', '--label', 'Spur focus', '--cwd', cwd], { encoding: 'utf8' })
    try { spawnSync('herdr', ['pane', 'run', JSON.parse(r.stdout).result.root_pane.pane_id, CLAUDE]); return true } catch { return false }
  }
  if (process.env.TMUX) { spawn('tmux', ['new-window', '-n', 'spur-focus', '-c', cwd, CLAUDE], { stdio: 'ignore', detached: true }).unref(); return true }
  return false
}

export async function setup({ cfg, path, ctx, argv }) {
  const now = ctx.now, st = store()
  const PW = process.stdout.columns || 59, ROWS = process.stdout.rows || 30
  const center = str => sp(Math.floor((PW - vlen(str)) / 2)) + str
  const keyRow = ks => center(ks.map(([k, l]) => `${WH}${B}${k}${R}  ${GR}${l}${R}`).join('    '))
  const screen = (body, foot) => {
    const top = Math.max(1, Math.floor((ROWS - 2 - body.length) / 2))
    process.stdout.write(`\x1b[2J\x1b[H${[...Array(top).fill(''), ...body].join('\n')}\x1b[${ROWS - 1};1H${foot}`)
  }
  const quit = () => { process.stdout.write(`\x1b[?25h${R}\x1b[2J\x1b[H`); process.exit(0) }
  let s = { ...settings(cfg), muted: st.prefs().muted }
  const save = () => {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const { muted, ...spur } = s
    copyFileSync(path, `${path}.bak`)
    writeFileSync(path, JSON.stringify({ ...raw, spur: Object.fromEntries(Object.entries(spur).filter(([k, v]) => v !== DEFAULTS[k] || k === 'prompt')) }, null, 2) + '\n')
    st.savePrefs({ ...st.prefs(), muted })
    cfg.spur = spur
  }

  // Numbers from the config that can say "done today" (anything but a days count), and "days since" ones.
  const ids = Object.keys(cfg.metrics)
  const daysIds = ids.filter(i => cfg.metrics[i].format === 'days' || cfg.metrics[i].source?.measure === 'days_since')
  const label = i => i.replace(/_/g, ' ') // ids say what they count and when (delivered_today); labels repeat
  // "done" candidates: counts over today, or a command (it can print anything)
  const todayIds = ids.filter(i => !daysIds.includes(i) && (cfg.metrics[i].source?.window === 'today' || cfg.metrics[i].source?.type === 'command'))
  // Every setting: its setup question and its short name in edit. Setup asks all but the done sound.
  const FIELDS = () => [
    { key: 'on', name: 'Spur', q: 'Spur', opts: [[true, 'On'], [false, 'Off']] },
    { key: 'prompt', name: 'Pushes you to', q: 'What should it push you toward?', opts: [
      ...(s.prompt ? [[s.prompt, cap(s.prompt)]] : []),
      ['@type', 'Type it'], ['@claude', 'Work it out with Claude'],
    ] },
    { key: 'done', name: 'Done when', q: 'Done for the day when this is above 0', opts: [...todayIds.map(i => [i, label(i)]), [null, 'Nothing: I\'ll press d']] },
    { key: 'since', name: 'Day count', q: 'Count the days since', opts: [...daysIds.map(i => [i, label(i)]), [null, 'The last time I pressed d']] },
    { key: 'firstAfter', name: 'First nudge', q: 'First nudge, after your first prompt of the day', opts: [30, 45, 60, 90].map(m => [m, `${m} min`]) },
    { key: 'snooze', name: 'Snooze', q: 'Snooze length', opts: [30, 45, 60].map(m => [m, `${m} min`]) },
    { key: 'reasonFrom', name: 'Reason from', q: 'Ask for a reason to snooze from', opts: [[1, '1st snooze'], [2, '2nd snooze'], [3, '3rd snooze'], [0, 'Never']] },
    { key: 'cutoff', name: 'Quiet after', q: 'No new nudges after', opts: [['20:00', '20:00'], ['21:30', '21:30'], ['23:00', '23:00'], [null, 'No cutoff']] },
    { key: 'muted', name: 'Sound', q: 'Sound', opts: [[false, 'On'], [true, 'Muted']] },
  ]
  const STEPS = () => FIELDS().filter(f => f.key !== 'muted') // sound stays on; edit can mute it
  let mode, step = 0, pick = 0, typed = '', note = '', row = 0, typeFrom = 'setup'
  const firstPick = k => Math.max(0, STEPS()[step].opts.findIndex(([v]) => v === s[k]))
  const startSetup = () => { mode = 'setup'; step = 0; pick = firstPick('on') }
  const next = () => {
    const steps = STEPS()
    if (step === steps.length - 1 || s.on === false) { save(); mode = 'status'; return }
    step++; pick = firstPick(steps[step].key)
  }
  const drawSetup = () => {
    const sts = STEPS(), stp = sts[step]
    const rec = v => stp.opts.length > 1 && v === DEFAULTS[stp.key] && v != null
    // the options are centred as a block; "(recommended)" hangs off the right of its option
    const w = Math.max(...stp.opts.map(([, l]) => l.length)) + 2, pad = sp(Math.floor((PW - w) / 2))
    const body = mode === 'type'
      ? [center(`${WH}${B}${stp.q}${R}`), '', center(`${WH}${typed}${AM}▏${R}`), '', center(focusProblem(typed) && typed ? `${RD}${focusProblem(typed)}${R}` : `${GR}Verb first, short and clear: SHIP THE APP, SEND PITCHES${R}`)]
      : [center(`${WH}${B}${stp.q}${R}`), '', ...stp.opts.map(([v, l], j) => pad + (j === pick ? `${AM}${B}›${R} ${WH}${B}${l}${R}` : `  ${GR}${l}${R}`) + (rec(v) ? ` ${GN}(recommended)${R}` : ''))]
    screen([center(`${TN}${B}╾✺  S P U R   S E T U P${R}`), center(`${GR}${step + 1} / ${sts.length}${R}`), '', '', ...body, ...(note ? ['', center(`${AM}${note}${R}`)] : [])],
      mode === 'type' ? keyRow([['esc', 'back'], ['enter', 'next']]) : keyRow([['q', s.prompt ? 'back' : 'cancel'], ['↑ ↓', 'choose'], ['enter', step === sts.length - 1 ? 'save' : 'next']]))
  }

  // Status: what Spur will do next.
  let doneNow = false
  const nextUp = () => {
    const n = st.workDay(now, s)
    if (!s.on) return `${GR}Spur is off${R}`
    if (!s.prompt) return `${GR}No prompt yet: e to set one${R}`
    if (n.done || doneNow) return `${GN}${B}✓  Done for today${R}`
    if (n.fresh) return `${GR}Starts ${s.firstAfter} min after your first prompt${R}`
    const first = new Date(new Date(n.dayStart).getTime() + s.firstAfter * MIN)
    if (pastCutoff(now, s, n.dayStart)) return `${GR}Quiet now, back tomorrow${R}`
    if (now < first) return `${WH}First nudge at ${B}${hhmm(first)}${R}`
    if (n.until && now < new Date(n.until)) return `${AM}Snoozed until ${B}${hhmm(n.until)}${R}`
    return `${AM}Due at your next prompt${R}`
  }
  const drawStatus = () => {
    const sn = st.snoozesToday(now, s)
    const reason = { 0: 'never', 1: '1st', 2: '2nd', 3: '3rd' }[s.reasonFrom] ?? `${s.reasonFrom}th`
    screen([
      center(`${TN}${B}╾✺  S P U R${R}`), center(s.on ? `${GN}on${R}` : `${GR}off${R}`), '', '',
      center(nextUp()), '', '',
      ...(sn.length ? [center(`${AM}${'●'.repeat(sn.length)}${R}`), center(`${AM}Snooze ${sn.length}×${R}`),
        ...sn.slice(-4).map(x => center(`${GR}${hhmm(x.at)}${R}${x.reason ? `  ${WH}\x1b[3m“${x.reason}”${R}` : ''}`))] : [center(`${GR}No snoozes today${R}`)]),
      '', '',
      ...(s.prompt ? [center(`${GR}pushes you to ${WH}${s.prompt.toLowerCase()}${R}`)] : []),
      center(`${GR}done when ${s.done ? label(s.done) : 'you press d'} · first nudge ${s.firstAfter} min in${R}`),
      center(`${GR}snooze ${s.snooze} min · reason from ${reason === 'never' ? 'never' : `the ${reason}`} · ${s.cutoff ? `quiet after ${s.cutoff}` : 'no cutoff'}${R}`),
      ...(note ? ['', center(`${AM}${note}${R}`)] : []),
    ], keyRow([['q', 'back'], ['e', 'edit'], ['t', 'test']]))
  }
  // Edit: every setting on one screen; ↑ ↓ picks a row, ← → changes it, saved as you go.
  const drawEdit = () => {
    const fs = FIELDS(), w = Math.max(...fs.map(f => f.name.length)) + 3, vw = 26, pad = sp(Math.floor((PW - (2 + w + vw)) / 2))
    const rows = fs.map((f, i) => {
      const v = (f.opts.find(([x]) => x === s[f.key]) ?? f.opts[0])[1]
      return pad + (i === row ? `${AM}${B}›${R} ${WH}${B}${f.name.padEnd(w)}${R}${AM}‹${R} ${WH}${B}${v}${R} ${AM}›${R}` : `  ${GR}${f.name.padEnd(w)}${R}  ${WH}${v}${R}`)
    })
    const at = fs[row].key === 'prompt' && String(s.prompt).startsWith('@') ? center(`${AM}enter to ${s.prompt === '@type' ? 'type it' : 'start a chat with Claude'}${R}`) : ''
    screen([center(`${TN}${B}╾✺  S P U R   E D I T${R}`), '', '', ...rows, '', at, ...(note ? ['', center(`${AM}${note}${R}`)] : [])],
      keyRow([['q', 'back'], ['↑ ↓', 'choose'], ['← →', 'change']]))
  }
  const show = () => (mode === 'status' ? drawStatus() : mode === 'edit' ? drawEdit() : drawSetup())

  if (s.done && cfg.metrics[s.done]) { try { doneNow = isDone(await readMetric(cfg.metrics[s.done], ctx)) } catch {} }
  process.stdout.write('\x1b[?25l')
  if (!s.prompt || argv.includes('--again')) startSetup(); else if (argv.includes('--edit')) mode = 'edit'; else mode = 'status'
  show()
  process.stdin.setRawMode(true); process.stdin.resume()
  process.stdin.on('data', b => {
    const key = b.toString()
    if (key === '\x03') quit()
    note = ''
    if (mode === 'type') {
      if (key === '\x1b') { mode = typeFrom; if (typeFrom === 'edit') s.prompt = settings(cfg).prompt }
      else if (key === '\r') {
        if (typed && !focusProblem(typed)) {
          s.prompt = typed.trim().replace(/\s+/g, ' ').toUpperCase(); mode = typeFrom
          if (typeFrom === 'edit') save(); else next()
        }
      }
      else if (key === '\x7f') typed = typed.slice(0, -1)
      else if (key >= ' ' && !key.startsWith('\x1b')) typed = (typed + key).toUpperCase().slice(0, 40)
      return show()
    }
    if (mode === 'setup') {
      const stp = STEPS()[step]
      if (key === 'q' || key === 'Q' || key === '\x1b') { if (s.prompt) { s = { ...settings(cfg), muted: st.prefs().muted }; mode = 'status' } else quit() }
      else if (key === '\x1b[A' || key === 'k') pick = (pick + stp.opts.length - 1) % stp.opts.length
      else if (key === '\x1b[B' || key === 'j') pick = (pick + 1) % stp.opts.length
      else if (key === '\r') {
        const v = stp.opts[pick][0]
        if (v === '@type') { mode = 'type'; typeFrom = 'setup'; typed = '' }
        else if (v === '@claude') {
          if (discuss(dirname(path))) quit()
          note = `Run this in a new terminal: ${CLAUDE}`
        } else { s[stp.key] = v; next() }
      }
      return show()
    }
    if (mode === 'edit') {
      const f = FIELDS()[row], i = Math.max(0, f.opts.findIndex(([v]) => v === s[f.key]))
      const leave = () => { if (String(s.prompt).startsWith('@')) s.prompt = settings(cfg).prompt } // a choice, not a value
      if (key === 'q' || key === 'Q' || key === '\x1b') { leave(); mode = 'status' }
      else if (key === '\x1b[A' || key === 'k') { leave(); row = (row + FIELDS().length - 1) % FIELDS().length }
      else if (key === '\x1b[B' || key === 'j') { leave(); row = (row + 1) % FIELDS().length }
      else if (key === '\x1b[C' || key === '\x1b[D' || key === 'l' || key === 'h') {
        s[f.key] = f.opts[(i + (key === '\x1b[C' || key === 'l' ? 1 : f.opts.length - 1)) % f.opts.length][0]
        if (!String(s.prompt).startsWith('@')) save()
      } else if (key === '\r' && s.prompt === '@type') { mode = 'type'; typeFrom = 'edit'; typed = '' }
      else if (key === '\r' && s.prompt === '@claude') {
        leave()
        if (discuss(dirname(path))) quit()
        note = `Run this in a new terminal: ${CLAUDE}`
      }
      return show()
    }
    if (key === 'q' || key === 'Q' || key === '\x1b') quit()
    if (key === 'e' || key === 'E') { mode = 'edit'; row = 0 }
    if (key === 't' || key === 'T') { // the test popup, in this window, then back here
      spawnSync(process.execPath, [new URL('../bin/tally.mjs', import.meta.url).pathname, 'spur', 'test', '--config', path], { stdio: 'inherit' })
      process.stdin.setRawMode(true); process.stdout.write('\x1b[?25l')
    }
    show()
  })
}
