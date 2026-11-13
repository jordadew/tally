// The done screen: the prompt is struck through and turns green, dissolves under a burst of rays and fading confetti, then DONE stamps in. Times are seconds
// since d (s); the done sound (done-<name>.mp3) is mixed to these same times.
import { Canvas, rgb, mix } from './art.mjs'
import { block } from './font.mjs'

const B = '\x1b[1m'
const GN = [120, 200, 120], GN_HI = [200, 255, 200], WH = [242, 242, 242]
const GREEN = v => mix([20, 60, 28], GN_HI, v)
const clamp = x => Math.max(0, Math.min(1, x))
const ease = x => 1 - Math.pow(1 - clamp(x), 3)
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x) }
const scale = (c, f) => c.map(v => v * f)
const rnd = (i, k = 0) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v) }
const jit = (j, r) => { const v = Math.sin(j * 12.9898 + r * 78.233) * 43758.5453; return v - Math.floor(v) }

// DONE in the intro's letter style (Tally's banner font), 35 wide, 6 tall.
const DONE = [
  ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
]
const DONE_W = DONE.reduce((w, L) => w + L[0].length, 0)
// How DONE leaves: from 2.0s after d, over 0.6s, the letters
// break into green dots that drift up and fade, echoing the burst. e = seconds into the exit.
const EXIT = 2.0, LEN = 0.6
function sparkleOut(cv, e, cells) {
  if (e < 0) return false
  const k = smooth(e / LEN)
  cells.forEach((c, i) => {
    if (rnd(i, 7) > k) cv.put(c.x, c.y, c.ch, `${B}${rgb(scale(GN, 1 - k * 0.6))}`)
    else {
      const age = e - LEN * rnd(i, 7)
      for (let d = 0; d < 2; d++) cv.dot(c.x * 2 + d + (rnd(i, d) - 0.5) * 6 * age, c.y * 4 + 1 - age * 18 - d * 2, Math.max(0, 0.9 - age * 1.6), GREEN)
    }
  })
  return true
}

// DONE's settled characters, for an exit animation: { x, y, ch, i (letter) }.
export function doneCells(x, y) {
  const out = []
  DONE.forEach((L, i) => { L.forEach((row, r) => [...row].forEach((ch, j) => { if (ch !== ' ') out.push({ x: x + j, y: y + r, ch, i }) })); x += L[0].length })
  return out
}
function stampDone(cv, x, y, t, step = 0.08) {
  DONE.forEach((L, i) => {
    const s = t - i * step
    if (s >= 0) {
      const col = mix(WH, GN, s / 0.25), drop = s < 0.06 ? -1 : 0
      L.forEach((row, r) => [...row].forEach((ch, j) => { if (ch !== ' ') cv.put(x + j, y + r + drop, ch, `${B}${rgb(col)}`) }))
    }
    x += L[0].length
  })
}

// The burst: rays shooting out like a firework, with confetti that spreads, slows and fades. u = seconds
// since it began; (cx, cy) in braille dots.
function burst(cv, u, cx, cy) {
  if (u < 0.7) for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd(i) * 0.2, speed = 0.75 + rnd(i, 1) * 0.5
    const head = 6 + 52 * speed * ease(u / 0.6), len = 10 * (1 - u / 0.7)
    for (let k = 0; k < len; k += 0.7) {
      const d = head - k, v = Math.max(0, (0.95 - u * 1.3) * (1 - k / len))
      cv.dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.55, v, GREEN)
    }
  }
  if (u < 1.0) for (let i = 0; i < 70; i++) {
    const a = rnd(i) * Math.PI * 2, sp = 20 + rnd(i, 1) * 45, life = 0.6 + rnd(i, 5) * 0.4
    const k = 1 - Math.pow(1 - Math.min(1, u / life), 2.2)
    const f = 1 - Math.min(1, u / life), tw = rnd(i, Math.floor(u * 18)) > 0.25 ? 1 : 0.4
    if (f > 0) cv.dot(cx + Math.cos(a) * sp * k * 1.1, cy + Math.sin(a) * sp * 0.5 * k, smooth(f) * tw, GREEN)
  }
}

// One frame of the done screen. W × H = the popup; prompt = the prompt's lines (upper case) and top = the
// row its first line starts on, both as the page drew them (a second line sits 4 rows below the first).
// Returns the canvas lines plus kf, how much of the rest of the page (count, snoozes, keys) still shows.
export function doneFrame(s, { W, H, prompt, top, exit }) {
  const cv = new Canvas(W, H)
  const p = s < 0 ? 0 : ease(s / 0.5)
  // The prompt glides from where the page had it to the middle of the popup while the rest of the page
  // fades (0–0.4s), so the burst and DONE play centred, as the intro does.
  const span = prompt.length * 4 - 1, mid = Math.floor((H - span) / 2)
  const at = Math.round(top + (mid - top) * smooth(s / 0.4))
  prompt.forEach((text, li) => {
    const rows = block(text), x0 = Math.floor((W - rows[0].length) / 2), y0 = at + li * 4, rr = li * 3
    const fadeAt = (j, r) => 1 - smooth((s - 0.45 - 0.25 * jit(j, r + rr)) / 0.45)
    rows.forEach((row, r) => [...row].forEach((ch, j) => {
      const f = fadeAt(j, r)
      if (f <= 0) return
      if (ch !== ' ') cv.put(x0 + j, y0 + r, ch, `${B}${rgb(scale(j < p * row.length ? GN : WH, f))}`)
      else if (r === 1 && j < (row.length + 2) * p - 1) cv.put(x0 + j, y0 + 1, '━', `${B}${rgb(scale(GN, f))}`)
    }))
    for (const j of [-1, rows[1].length])
      if ((j < 0 ? p > 0 : p > 0.98) && fadeAt(j, 1) > 0) cv.put(x0 + j, y0 + 1, '━', `${B}${rgb(scale(GN, fadeAt(j, 1)))}`)
  })
  if (s >= 0.55 && s < 1.6) burst(cv, s - 0.55, W, (mid + span / 2) * 4)
  const dx = Math.floor((W - DONE_W) / 2), dy = Math.floor((H - 6) / 2)
  // exit(cv, s, cells) may draw DONE leaving (cells = its settled characters); false = not yet
  const leave = exit ?? ((c, t, cells) => sparkleOut(c, t - EXIT, cells))
  if (s >= 0.9 && !leave(cv, s, doneCells(dx, dy))) stampDone(cv, dx, dy, s - 0.9)
  return { lines: cv.lines(), kf: 1 - smooth(s / 0.35), at }
}
