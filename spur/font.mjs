// Spur's prompt type: 3-row block letters, A–Z and 0–9, and the rules a prompt must fit.
// The prompt's block type: 3 rows, A–Z and 0–9, letters 3 wide (M, W 5), one column between letters.
export const FONT = {
  A: ['▄▀▄', '█▀█', '▀ ▀'], B: ['█▀▄', '█▀▄', '▀▀ '], C: ['█▀▀', '█  ', '▀▀▀'], D: ['█▀▄', '█ █', '▀▀ '],
  E: ['█▀▀', '█▀▀', '▀▀▀'], F: ['█▀▀', '█▀▀', '▀  '], G: ['█▀▀', '█ █', '▀▀▀'], H: ['█ █', '█▀█', '▀ ▀'],
  I: ['▀█▀', ' █ ', '▀▀▀'], J: ['  █', '▄ █', '▀▀▀'], K: ['█ ▄', '█▀▄', '▀ ▀'], L: ['█  ', '█  ', '▀▀▀'],
  M: ['█▄ ▄█', '█ ▀ █', '▀   ▀'], N: ['█▀█', '█ █', '▀ ▀'], O: ['█▀█', '█ █', '▀▀▀'], P: ['█▀█', '█▀▀', '▀  '],
  Q: ['█▀█', '█ █', '▀▀█'], R: ['█▀▄', '█▀▄', '▀ ▀'], S: ['█▀▀', '▀▀█', '▀▀▀'], T: ['▀█▀', ' █ ', ' ▀ '],
  U: ['█ █', '█ █', '▀▀▀'], V: ['█ █', '█ █', ' ▀ '], W: ['█ ▄ █', '█▄▀▄█', '▀   ▀'], X: ['▀▄▀', '▄▀▄', '▀ ▀'],
  Y: ['█ █', '▀█▀', ' ▀ '], Z: ['▀▀█', '▄▀ ', '▀▀▀'],
  0: ['█▀█', '█ █', '▀▀▀'], 1: ['▀█ ', ' █ ', '▀▀▀'], 2: ['▀▀█', '█▀▀', '▀▀▀'], 3: ['▀▀█', ' ▀█', '▀▀▀'], 4: ['█ █', '▀▀█', '  ▀'],
  5: ['█▀▀', '▀▀█', '▀▀▀'], 6: ['█▀▀', '█▀█', '▀▀▀'], 7: ['▀▀█', '  █', '  ▀'], 8: ['█▀█', '█▀█', '▀▀▀'], 9: ['█▀█', '▀▀█', '▀▀▀'],
  ' ': [' ', ' ', ' '], // a word gap of 3 with the joins
}
const blockWidth = t => [...t.toUpperCase()].reduce((w, ch) => w + (FONT[ch] ?? FONT[' '])[0].length, 0) + Math.max(0, [...t].length - 1)
export const block = text => [0, 1, 2].map(r => [...text.toUpperCase()].map(ch => FONT[ch]?.[r] ?? FONT[' '][r]).join(' '))
// The prompt on one line if it fits the popup (57 of its 59 columns), else split into 2 lines as
// evenly as possible; 3+ lines means it's too long (focusProblem).
export const PROMPT_MAX = 57
export function promptLines(text) {
  text = text.toUpperCase()
  if (blockWidth(text) <= PROMPT_MAX) return [text]
  const w = text.split(' ')
  const splits = w.slice(1).map((_, i) => [w.slice(0, i + 1).join(' '), w.slice(i + 1).join(' ')])
  const ok = splits.filter(p => p.every(l => blockWidth(l) <= PROMPT_MAX))
  if (!ok.length) return [text, '', ''] // doesn't fit in 2
  return ok.sort((a, b) => Math.max(...a.map(blockWidth)) - Math.max(...b.map(blockWidth)))[0]
}
// Why a custom focus can't be used, or null if it's fine. Words are upper-cased first.
export function focusProblem(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (!text) return 'empty'
  const bad = [...new Set([...text].filter(ch => !FONT[ch]))]
  if (bad.length) return `only A–Z, 0–9 and spaces (not ${bad.join(' ')})`
  if (text.split(' ').some(w => blockWidth(w) > PROMPT_MAX)) return 'a word is too long for one line'
  if (promptLines(text).length > 2) return 'too long: it must fit on 2 lines of the popup'
  return null
}
