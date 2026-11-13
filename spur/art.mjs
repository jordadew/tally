// Spur's title sequence: real geometry rasterised into braille dots (2×4 per cell), 24-bit colour.
// Timed to the intro sound (spur.mp3): whip 0s, spur jingle 0.61s (the rowel spins in), yeehaw 0.82s
// (SPUR stamps letter by letter).
const R0 = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m'
export const rgb = ([r, g, b]) => `\x1b[38;2;${r | 0};${g | 0};${b | 0}m`
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)))
const STEEL = v => mix([58, 64, 76], [246, 248, 252], v)
const BRASS = v => mix([88, 52, 22], [255, 222, 160], v)
const EMBER = v => mix([120, 40, 10], [255, 240, 200], v)
const TAN = [214, 168, 112]
const TAU = Math.PI * 2

// ---------------------------------------------------------------- braille canvas
const BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.dw = w * 2; this.dh = h * 4; this.v = new Float32Array(this.dw * this.dh).fill(-1); this.p = new Array(this.dw * this.dh); this.text = new Map() }
  dot(x, y, v, pal = STEEL) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.dw || y >= this.dh) return
    const i = y * this.dw + x
    if (v > this.v[i]) { this.v[i] = v; this.p[i] = pal }
  }
  put(cx, cy, s, color) { [...s].forEach((ch, i) => this.text.set(`${cx + i},${cy}`, `${color}${ch}`)) }
  lines() {
    const out = []
    for (let cy = 0; cy < this.h; cy++) {
      let line = ''
      for (let cx = 0; cx < this.w; cx++) {
        const t = this.text.get(`${cx},${cy}`)
        if (t) { line += t + R0; continue }
        let bits = 0, max = -1, pal = STEEL
        for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
          const i = (cy * 4 + y) * this.dw + cx * 2 + x
          if (this.v[i] >= 0) { bits |= BITS[y][x]; if (this.v[i] > max) { max = this.v[i]; pal = this.p[i] } }
        }
        line += bits ? `${rgb(pal(max))}${String.fromCharCode(0x2800 + bits)}` : ' '
      }
      out.push(line + R0)
    }
    return out
  }
}

// A rowel: toothed star wheel with a hub ring and axle pin. Lit from the top-left, so the highlight
// stays put while the points turn, like polished steel. squash < 1 = turned edge-on (coin flip).
export function rowel(cv, cx, cy, R, th, { n = 10, squash = 1, pal = STEEL, glow = 0 } = {}) {
  const hubOut = R * 0.44, hole = R * 0.17, base = R * 0.4, seg = TAU / n, half = seg * 0.3
  const sq = Math.max(Math.abs(squash), 0.06)
  for (let y = -R; y <= R; y++) for (let x = -R * sq; x <= R * sq; x++) {
    const dx = x / sq, dy = y, r = Math.hypot(dx, dy)
    if (r > R) continue
    const a = Math.atan2(dy, dx)
    const local = ((((a - th) % seg) + seg) % seg) - seg / 2
    const tip = base + (R - base) * (1 - Math.abs(local) / half)
    const inSpike = Math.abs(local) < half && r >= base - 1 && r <= tip
    const inHub = r <= hubOut && r >= hole
    const pin = r < hole * 0.55
    if (!inSpike && !inHub && !pin) continue
    const light = 0.5 + 0.5 * Math.cos(a + 2.3)
    let v = pin ? 0.25 : 0.28 + 0.42 * light + (inSpike ? 0.3 * (r / R) : 0.08 * (1 - r / hubOut))
    if (inHub && r > hubOut - 1.6) v += 0.15 // bevel on the hub's rim
    v = v * (0.35 + 0.65 * Math.abs(squash)) + glow
    cv.dot(cx + x, cy + y, Math.min(1, v), pal)
  }
}

export function line(cv, x0, y0, x1, y1, thick, v, pal) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2)
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t
    for (let k = -thick; k <= thick; k++) cv.dot(x, y + k, v(t, k), pal)
  }
}

// Sparks: deterministic per seed so they flicker rather than smear.
export function sparks(cv, cx, cy, R, t, count, pal = EMBER) {
  for (let i = 0; i < count; i++) {
    const s = Math.sin(i * 91.7 + Math.floor(t * 14) * 13.1) * 43758.5453
    const f = s - Math.floor(s), g = (s * 7.3) - Math.floor(s * 7.3)
    const a = f * TAU, d = R * (1.05 + g * 0.6)
    cv.dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.6 + g * 0.4, pal)
  }
}


// Big block letters for SPUR (from Tally's banner font).
const SPUR = [
  ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
]


export const SETTLED = 2.0 // seconds: the rowel has mostly coasted down by here; the popup fades after

// One frame of the title (58 × 21 cells). t in seconds since the sound began.
export function title(t) {
  const cv = new Canvas(58, 21)
  // whip: a lash travels along a curve, then the tip cracks
  if (t < 0.7) {
    const reach = Math.min(1, t / 0.3), fade = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.4
    const x0 = 4, x1 = 112, y0 = 16
    for (let i = 0; i <= 300 * reach; i++) {
      const u = i / 300, x = x0 + (x1 - x0) * u
      const y = y0 + Math.sin(u * 7 - t * 30) * 7 * u * (1 - u * 0.4) + u * 10
      const th = u < 0.3 ? 1 : 0
      for (let d = -th; d <= th; d++) cv.dot(x, y + d, (0.4 + 0.5 * u) * fade, BRASS)
    }
    if (t >= 0.26 && t < 0.5) sparks(cv, x1, y0 + 7, 4 + (t - 0.26) * 40, t, 14, EMBER)
  }
  // rowel spins in on the spur jingle
  if (t >= 0.61) {
    const s = t - 0.61, ease = 1 - Math.exp(-s * 9), w = 30 * Math.exp(-s * 2.2)
    const th = (30 / 2.2) * (1 - Math.exp(-s * 2.2))
    rowel(cv, 22, 52, Math.round(20 * ease), th, { n: 10, glow: Math.max(0, 0.4 - s) })
    if (w > 6) sparks(cv, 22, 52, 20, t, 8)
  }
  // SPUR stamps letter by letter on the yeehaw, each flashing white then settling to tan
  if (t >= 0.82) {
    let x = 23
    SPUR.forEach((L, i) => {
      const s = t - 0.82 - i * 0.07
      if (s >= 0) {
        const col = mix([255, 255, 255], TAN, s / 0.25)
        const drop = s < 0.06 ? -1 : 0
        L.forEach((row, r) => cv.put(x, 10 + r + drop, row, `${BOLD}${rgb(col)}`))
      }
      x += L[0].length
    })
  }
  return cv.lines()
}
