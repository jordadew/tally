// Drawing: boxes, banner, value formats, colour rules and the five layouts.
export const B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[0m'
export const c = n => `\x1b[38;5;${n}m`
const TONES = { green: c(114), amber: c(215), red: c(203), grey: D, white: c(255) }
export const FADE = [255, 253, 251, 249, 247, 245]

export const vlen = s => [...String(s).replace(/\x1b\[[0-9;]*m/g, '')].length
export const sp = n => ' '.repeat(Math.max(0, Math.floor(n)))
export const padr = (s, w) => s + sp(w - vlen(s))
export const spread = (l, r, w) => l + sp(w - vlen(l) - vlen(r)) + r
export const center = (s, w) => { const g = w - vlen(s); return sp(g / 2) + s + sp(Math.ceil(g / 2)) }
export const clip = (t, n) => (vlen(t) <= n ? t : [...t].slice(0, n - 1).join('') + '…')
const titleCase = t => t.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())

export function box(title, lines, w, indent = '  ') {
  title = title ? titleCase(title) : ''
  const top = title ? `╭─ ${R}${B}${title}${R}${D} ${'─'.repeat(Math.max(0, w - 5 - vlen(title)))}╮` : `╭${'─'.repeat(w - 2)}╮`
  return [
    `${indent}${D}${top}${R}`,
    ...lines.map(l => `${indent}${D}│${R} ${padr(clipAnsi(l, w - 4), w - 4)} ${D}│${R}`),
    `${indent}${D}╰${'─'.repeat(w - 2)}╯${R}`,
  ]
}
/** Never let a line push a box border out of line. */
function clipAnsi(s, n) { return vlen(s) <= n ? s : clip(s.replace(/\x1b\[[0-9;]*m/g, ''), n) }

// ---------------------------------------------------------------- banner
const SHADOW = [
  '████████╗ █████╗ ██╗     ██╗     ██╗   ██╗',
  '╚══██╔══╝██╔══██╗██║     ██║     ╚██╗ ██╔╝',
  '   ██║   ███████║██║     ██║      ╚████╔╝ ',
  '   ██║   ██╔══██║██║     ██║       ╚██╔╝  ',
  '   ██║   ██║  ██║███████╗███████╗   ██║   ',
  '   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ',
]
/** config.banner: custom lines of ASCII art, or false for none. Default: the TALLY banner. */
export function banner(cfg, now) {
  const art = cfg.banner === false ? [] : Array.isArray(cfg.banner) ? cfg.banner : cfg.title && cfg.title !== 'TALLY' ? null : SHADOW
  const out = ['']
  if (art) art.forEach((l, i) => out.push(`  ${B}${c(FADE[Math.min(i, FADE.length - 1)])}${center(l, cfg.width)}${R}`))
  else out.push(`  ${B}${c(255)}${center(cfg.title, cfg.width)}${R}`)
  const date = now.toLocaleDateString(cfg.locale ?? 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase().replace(',', '')
  out.push(`  ${D}${center(date, cfg.width)}${R}`)
  return out
}

// ---------------------------------------------------------------- values
const COND = /^(>=|<=|>|<|==|!=)\s*(-?[\d.]+)$/
const test = (v, cond) => {
  const m = COND.exec(String(cond).trim()); if (!m || typeof v !== 'number') return false
  const n = +m[2]
  return { '>=': v >= n, '<=': v <= n, '>': v > n, '<': v < n, '==': v === n, '!=': v !== n }[m[1]]
}
/** metric.tone: { "red": ">= 5", "amber": ">= 2", "green": "> 0" }. Checked red, amber, green; first match wins. */
export function tone(metric, v, hidden) {
  if (hidden && metric.sensitive) return TONES.grey
  if (v == null) return TONES.grey
  for (const t of ['red', 'amber', 'green', 'grey']) if (metric.tone?.[t] != null && test(v, metric.tone[t])) return TONES[t]
  return TONES.white
}

/** format: number (default) | money | days | percent | text */
export function fmt(metric, r, cfg, hidden) {
  if (!r || r.error) return r?.error ? `${TONES.red}!${R}` : '–'
  const v = r.value
  if (v == null) return '–'
  if (hidden && metric.sensitive) return metric.format === 'money' ? `${cfg.currency}•••` : '•••'
  switch (metric.format) {
    case 'money': return `${cfg.currency}${Number(v).toLocaleString(cfg.locale ?? 'en-GB')}`
    case 'days': return v === 0 ? 'today' : `${v}d`
    case 'percent': return `${v}%`
    default: return Array.isArray(v) ? String(v.length) : typeof v === 'number' ? v.toLocaleString(cfg.locale ?? 'en-GB') : String(v)
  }
}
const num = r => (typeof r?.value === 'number' ? r.value : Array.isArray(r?.value) ? r.value.length : null)
const valueCell = (id, ctx) => { const m = ctx.cfg.metrics[id]; return `${B}${tone(m, num(ctx.data[id]), ctx.hidden)}${fmt(m, ctx.data[id], ctx.cfg, ctx.hidden)}${R}` }
const label = id => ctx => ctx.cfg.metrics[id].label ?? id.replace(/_/g, ' ')

export function sectionTitle(t, now, locale = 'en-GB') {
  return (t ?? '')
    .replace('{month}', now.toLocaleDateString(locale, { month: 'long' }))
    .replace('{weekday}', now.toLocaleDateString(locale, { weekday: 'long' }))
    .replace('{date}', now.toLocaleDateString(locale, { day: 'numeric', month: 'short' }))
}

// ---------------------------------------------------------------- layouts
/** Split w into n widths that add up exactly. */
const split = (w, n) => Array.from({ length: n }, (_, i) => Math.floor((w * (i + 1)) / n) - Math.floor((w * i) / n))

export const LAYOUTS = {
  /** Numbers in a row, label under each. Best for 2–5 metrics. */
  strip(s, ctx) {
    const inner = ctx.cfg.width - 4, cols = split(inner, s.metrics.length)
    return box(ctx.title(s), [
      s.metrics.map((id, i) => center(valueCell(id, ctx), cols[i])).join(''),
      s.metrics.map((id, i) => center(`${D}${clip(label(id)(ctx), cols[i] - 1)}${R}`, cols[i])).join(''),
    ], ctx.cfg.width)
  },

  /** One metric per line: label, value, optional detail on the right. */
  rows(s, ctx) {
    const inner = ctx.cfg.width - 4, lw = Math.max(...s.metrics.map(id => vlen(label(id)(ctx)))) + 2
    return box(ctx.title(s), s.metrics.map(id => spread(`${D}${padr(label(id)(ctx), lw)}${R}${valueCell(id, ctx)}`, `${D}${ctx.cfg.metrics[id].detail ?? ''}${R}`, inner)), ctx.cfg.width)
  },

  /** Two boxes side by side (e.g. today beside this week). left/right: { title, metrics, ticks }. */
  pair(s, ctx) {
    const W = ctx.cfg.width, lw = Math.round((W - 1) * (s.ratio ?? 0.4)), rw = W - lw - 1
    const side = (p, w) => box(sectionTitle(p.title, ctx.now, ctx.cfg.locale), p.metrics.map(id => {
      const n = num(ctx.data[id]), tick = p.ticks ? `${n > 0 ? c(114) + '✓' : D + '○'}${R} ` : ''
      return spread(`${tick}${D}${label(id)(ctx)}${R}`, valueCell(id, ctx), w - 4)
    }), w, '')
    const L = side(s.left, lw), Rt = side(s.right, rw)
    const h = Math.max(L.length, Rt.length)
    const fill = (b, w) => { while (b.length < h) b.splice(b.length - 1, 0, `${D}│${R}${sp(w - 2)}${D}│${R}`); return b }
    fill(L, lw); fill(Rt, rw)
    return L.map((l, i) => `  ${l} ${Rt[i]}`)
  },

  /** One metric against a target, with a bar. Hidden + sensitive: a redacted bar. */
  progress(s, ctx) {
    const m = ctx.cfg.metrics[s.metric], inner = ctx.cfg.width - 4, v = num(ctx.data[s.metric]) ?? 0
    const masked = ctx.hidden && m.sensitive
    const tgt = { ...m, format: m.format, sensitive: m.sensitive }
    if (masked) return box(ctx.title(s), [
      spread(`${B}${D}${fmt(m, ctx.data[s.metric], ctx.cfg, true)}${R} ${D}of ${fmt(tgt, { value: s.target }, ctx.cfg, true)}${R}`, `${D}••%${R}`, inner),
      `${c(240)}${'▒'.repeat(inner)}${R}`,
    ], ctx.cfg.width)
    const pct = Math.floor((v * 100) / s.target), fill = Math.min(inner, Math.floor((v * inner) / s.target))
    const col = v >= s.target ? TONES.green : v === 0 ? TONES.red : TONES.white
    return box(ctx.title(s), [
      spread(`${B}${col}${fmt(m, ctx.data[s.metric], ctx.cfg, false)}${R} ${D}of ${fmt(tgt, { value: s.target }, ctx.cfg, false)}${R}`, `${D}${pct}%${R}`, inner),
      `${TONES.green}${'█'.repeat(fill)}${D}${'░'.repeat(inner - fill)}${R}`,
    ], ctx.cfg.width)
  },

  /** Next actions: text from metrics. metric.template "Film {value}", metric.empty when there's nothing. */
  list(s, ctx) {
    const lines = []
    for (const id of s.metrics) {
      const m = ctx.cfg.metrics[id], r = ctx.data[id]
      if (r?.error) { lines.push(`${TONES.red}! ${label(id)(ctx)}: ${r.error}${R}`); continue }
      const vals = Array.isArray(r?.value) ? r.value : r?.value == null || r?.value === '' ? [] : [r.value]
      if (!vals.length) { if (m.empty) lines.push(`${TONES.amber}${B}→${R} ${m.empty}`); continue }
      for (const v of vals.slice(0, m.max ?? 3)) {
        const shown = ctx.hidden && m.sensitive ? '•••••' : String(v)
        lines.push(`${TONES.amber}${B}→${R} ${(m.template ?? '{value}').replace('{value}', `${B}${shown}${R}`)}`)
      }
    }
    return box(ctx.title(s), lines.length ? lines : [`${D}nothing to do${R}`], ctx.cfg.width)
  },
}

export function panel(cfg, data, { now, hidden, note = '', keys }) {
  const ctx = { cfg, data, now, hidden, title: s => sectionTitle(s.title, now, cfg.locale) }
  const out = [...banner(cfg, now)]
  for (const s of cfg.sections) out.push(...LAYOUTS[s.layout](s, ctx))
  out.push('', `  ${spread(`${D}${keys}${R}`, note, cfg.width)}`)
  return out.join('\n')
}

// ---------------------------------------------------------------- loading
export function sweep(n, width) {
  const w = 24, len = 6, span = w - len, pos = n % (span * 2), x = pos <= span ? pos : span * 2 - pos
  const shade = ['░', '▒', '▓', '█', '▓', '▒']
  let bar = ''
  for (let i = 0; i < w; i++) bar += i >= x && i < x + len ? `${c(FADE[Math.abs(i - x - 3)] ?? 245)}${shade[i - x]}` : `${c(238)}─`
  return `  ${sp((width - w) / 2)}${bar}${R}`
}
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', WAVE = [255, 253, 250, 247, 244, 241, 239, 241, 244, 247, 250, 253]
export function updating(n) {
  const word = 'updating'
  return `${c(250)}${SPIN[n % SPIN.length]}${R} ` + [...word].map((ch, i) => `${c(WAVE[(n + (word.length - i)) % WAVE.length])}${ch}`).join('') + R
}
