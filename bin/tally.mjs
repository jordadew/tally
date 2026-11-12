#!/usr/bin/env node
// tally            open the panel (q / Esc close, h hides sensitive numbers)
// tally --once     print the panel once and exit (scripts, shell login)
// tally --daily    open only if it hasn't been shown today (for a startup hook)
// tally check      read every metric and print its value or error
// tally preview    try layouts per section: Tab picks a section, ↑ ↓ changes its layout, w saves
// Options: --config <path>  --sample (preview with made-up numbers)  --close-key <letter> (ctrl+letter also closes)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { configPath, loadConfig, stateDir } from '../src/config.mjs'
import { readAll } from '../src/sources.mjs'
import { panel, banner, sweep, updating, sectionTitle, D, R, B, c } from '../src/render.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'open'
const flag = f => argv.includes(f)
const opt = f => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined }

if (cmd === 'help' || flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('// ')).map(l => l.slice(3)).join('\n'))
  process.exit(0)
}

const path = configPath(process.argv)
let cfg
try { cfg = loadConfig(path) } catch (e) { console.error(e.message); process.exit(1) }
const now = process.env.TALLY_NOW ? new Date(process.env.TALLY_NOW) : new Date()
const ctx = { now, weekStart: cfg.weekStart, base: dirname(path) }
const STATE = stateDir(), key = createHash('sha1').update(path).digest('hex').slice(0, 8)
const CACHE = join(STATE, `last-${key}.json`), HIDDEN = join(STATE, 'hidden')
const save = (file, body) => { try { mkdirSync(STATE, { recursive: true }); writeFileSync(file, body) } catch {} }

// ---------------------------------------------------------------- check
if (cmd === 'check') {
  const ids = Object.keys(cfg.metrics)
  const w = Math.max(...ids.map(i => i.length))
  for (const id of ids) {
    const t = performance.now()
    const r = (await readAll({ [id]: cfg.metrics[id] }, ctx))[id]
    const ms = `${Math.round(performance.now() - t)}ms`.padStart(7)
    console.log(`${id.padEnd(w)}  ${ms}  ${r.error ? `\x1b[31mERROR\x1b[0m ${r.error}` : JSON.stringify(r.value)}`)
  }
  process.exit(0)
}

// ---------------------------------------------------------------- daily
if (flag('--daily')) {
  const stamp = join(STATE, `shown-${key}`), today = now.toISOString().slice(0, 10)
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === today) process.exit(0)
  save(stamp, today)
}

const once = flag('--once') || !process.stdin.isTTY
let hidden = existsSync(HIDDEN) || flag('--hidden')
const hasSensitive = Object.values(cfg.metrics).some(m => m.sensitive)
const keys = () => `q close${hasSensitive ? ` · h ${hidden ? 'show' : 'hide'}` : ''}`
const draw = s => process.stdout.write(`\x1b[2J\x1b[H${s}`)
const closeKey = opt('--close-key')
const closeByte = closeKey ? String.fromCharCode(closeKey.toLowerCase().charCodeAt(0) - 96) : null
const quit = () => { process.stdout.write(`\x1b[?25h${R}\n`); process.exit(0) }

// ---------------------------------------------------------------- preview
if (cmd === 'preview') {
  const sample = () => Object.fromEntries(Object.entries(cfg.metrics).map(([id, m]) => {
    const r = n => Math.floor(Math.random() * n)
    const v = m.format === 'money' ? r(50) * 100 : m.format === 'days' ? r(9) : m.format === 'percent' ? r(100)
      : ['lines', 'text'].includes(m.source.parse) || m.source.measure === 'first' ? `Example ${id.replace(/_/g, ' ')}` : r(12)
    return [id, { value: v }]
  }))
  const data = flag('--sample') ? sample() : await readAll(cfg.metrics, ctx)
  const ids = s => s.metrics ?? (s.layout === 'pair' ? [...s.left.metrics, ...s.right.metrics] : [s.metric])
  const variants = cfg.sections.map(s => {
    const all = ids(s), half = Math.ceil(all.length / 2), title = s.title ?? s.left?.title
    const v = {
      strip: { title, layout: 'strip', metrics: all },
      rows: { title, layout: 'rows', metrics: all },
      list: { title, layout: 'list', metrics: all },
      pair: all.length > 1 ? { layout: 'pair', left: s.left ?? { title, metrics: all.slice(0, half) }, right: s.right ?? { title: 'This week', metrics: all.slice(half) } } : null,
      progress: s.target ? { title, layout: 'progress', metric: all[0], target: s.target } : null,
    }
    v[s.layout] = s
    return Object.entries(v).filter(([, x]) => x).map(([, x]) => x)
  })
  const pick = cfg.sections.map((s, i) => variants[i].indexOf(s))
  let sel = 0
  const current = () => ({ ...cfg, sections: variants.map((v, i) => v[pick[i]]) })
  const render = () => {
    const c2 = current()
    draw(panel(c2, data, { now, hidden, keys: '' }) + `\n  ${B}section ${sel + 1}/${c2.sections.length}${R}${D} ${sectionTitle(c2.sections[sel].title ?? c2.sections[sel].left?.title, now, cfg.locale)} · ${c2.sections[sel].layout}${R}\n  ${D}tab next section · ↑ ↓ layout · w save · q quit${R}`)
  }
  if (once) { process.stdout.write(panel(current(), data, { now, hidden, keys: '' }) + '\n'); process.exit(0) }
  process.stdout.write('\x1b[?25l'); process.stdin.setRawMode(true); render()
  process.stdin.on('data', k => {
    const s = k.toString()
    if (s === 'q' || s === '\x1b' || s === '\x03' || s === closeByte) quit()
    else if (s === '\t' || s === '\x1b[C') sel = (sel + 1) % pick.length
    else if (s === '\x1b[Z' || s === '\x1b[D') sel = (sel + pick.length - 1) % pick.length
    else if (s === '\x1b[A') pick[sel] = (pick[sel] + variants[sel].length - 1) % variants[sel].length
    else if (s === '\x1b[B') pick[sel] = (pick[sel] + 1) % variants[sel].length
    else if (s === 'h') hidden = !hidden
    else if (s === 'w') {
      copyFileSync(path, `${path}.bak`)
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      raw.sections = current().sections
      writeFileSync(path, JSON.stringify(raw, null, 2) + '\n')
      render(); process.stdout.write(`\n  ${c(114)}saved to ${path} (old one kept as .bak)${R}`); return
    } else return
    render()
  })
} else {
  // ---------------------------------------------------------------- open
  let view = null
  if (!once) {
    process.stdin.setRawMode(true)
    process.stdin.on('data', k => {
      const s = k.toString()
      if (s === 'q' || s === 'Q' || s === '\x1b' || s === '\x03' || s === closeByte) quit()
      if ((s === 'h' || s === 'H') && hasSensitive) {
        hidden = !hidden
        try { hidden ? save(HIDDEN, '') : rmSync(HIDDEN, { force: true }) } catch {}
        if (view) draw(panel(cfg, view.data, { now, hidden, note: view.note, keys: keys() }))
      }
    })
    process.stdout.write('\x1b[?25l')
  }

  // The last result shows at once; fresh numbers replace it (a slow source can take seconds).
  let cached = null
  try { cached = JSON.parse(readFileSync(CACHE, 'utf8')) } catch {}
  let anim = null, n = 0
  if (!once && cached) {
    view = { data: cached.data, note: '' }
    draw(panel(cfg, cached.data, { now, hidden, keys: keys() }))
    const tick = () => {
      const row = panel(cfg, cached.data, { now, hidden, keys: keys() }).split('\n').length
      process.stdout.write(`\x1b[${row};1H\x1b[2K  ${D}${keys()}${R}${' '.repeat(Math.max(1, cfg.width - keys().length - 10))}${updating(n++)}`)
    }
    tick(); anim = setInterval(tick, 80)
  } else if (!once) {
    anim = setInterval(() => draw(`${banner(cfg, now).join('\n')}\n\n\n\n\n\n${sweep(n++, cfg.width)}`), 60)
  }

  const data = await readAll(cfg.metrics, ctx)
  clearInterval(anim)
  const failed = Object.values(data).filter(r => r.error).length
  let note = ''
  if (cached && failed) { // keep the last good value for anything that failed, and say so
    for (const [id, r] of Object.entries(data)) if (r.error && cached.data[id] && !cached.data[id].error) data[id] = cached.data[id]
    note = `${D}${failed} failed, last values from ${new Date(cached.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${R}`
  }
  save(CACHE, JSON.stringify({ at: Date.now(), data }))
  view = { data, note }
  const out = panel(cfg, data, { now, hidden, note, keys: keys() })
  if (once) { process.stdout.write(out + '\n'); process.exit(0) }
  draw(out)
}
