// Spur's settings, state and the rules for when it fires. State lives in Tally's state folder
// (~/.local/state/tally/spur/), never in the config; settings come from the config's "spur" block.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { stateDir, expand } from '../src/config.mjs'

export const DEFAULTS = {
  on: true, prompt: null, done: null, since: null,
  firstAfter: 45, snooze: 45, reasonFrom: 2, cutoff: null, newDayAfter: 5,
  days: [1, 2, 3, 4, 5], // the days it nudges on, as getDay() numbers (0 = Sunday)
  log: null, // a daily-note path with {date}, e.g. "~/notes/daily/{date}.md": each snooze is added there too
}
// Days are shown Monday first.
export const DAYS = [[1, 'M', 'Mon', 'Monday'], [2, 'T', 'Tue', 'Tuesday'], [3, 'W', 'Wed', 'Wednesday'], [4, 'T', 'Thu', 'Thursday'], [5, 'F', 'Fri', 'Friday'], [6, 'S', 'Sat', 'Saturday'], [0, 'S', 'Sun', 'Sunday']]
export const PRESETS = [['Weekdays', [1, 2, 3, 4, 5]], ['Every day', [1, 2, 3, 4, 5, 6, 0]], ['Weekends', [6, 0]]]
export const sameDays = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(x => b.includes(x))
export const presetOf = days => PRESETS.findIndex(([, d]) => sameDays(d, days))
// "Weekdays", "Every day", "Weekends", a run "Tue–Thu", or a list "Mon, Wed, Fri"
export function daysName(days) {
  const p = presetOf(days)
  if (p >= 0) return PRESETS[p][0]
  const idx = DAYS.map(([d], i) => (days.includes(d) ? i : -1)).filter(i => i >= 0)
  if (idx.length > 2 && idx.every((x, i) => !i || x === idx[i - 1] + 1)) return `${DAYS[idx[0]][2]}–${DAYS[idx.at(-1)][2]}`
  return idx.map(i => DAYS[i][2]).join(', ')
}
export const settings = cfg => ({ ...DEFAULTS, ...(cfg.spur ?? {}) })

const MIN = 60_000
// Days turn over at 06:00: until then it is still the day before (Sunday 01:00 is Sunday, not Monday).
export const DAY_TURN = 6
export const workDate = d => new Date(new Date(d).getTime() - DAY_TURN * 3600e3)
const dayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const lines = file => { try { return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }

export function store(dir = join(stateDir(), 'spur')) {
  const NUDGE = join(dir, 'nudge.json'), SNOOZES = join(dir, 'snoozes.jsonl'), DONE = join(dir, 'done.jsonl'), PREFS = join(dir, 'prefs.json')
  const put = (file, body, append) => { mkdirSync(dir, { recursive: true }); (append ? appendFileSync : writeFileSync)(file, body) }
  const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
  const st = {
    dir, LOCK: join(dir, 'spur.pid'),
    readNudge: () => read(NUDGE),
    writeNudge: n => put(NUDGE, JSON.stringify(n)),
    // m on the popup: remembered here, not in the config
    prefs: () => ({ muted: false, ...read(PREFS) }),
    savePrefs: p => put(PREFS, JSON.stringify(p)),
    // The work day starts at the first prompt after a break of newDayAfter hours, and only once the
    // date has turned (06:00), so working past midnight still counts as the day before.
    // fresh = no prompt yet since that break.
    workDay(now, s) {
      const n = st.readNudge(), last = n.lastPrompt ? new Date(n.lastPrompt) : null
      const sameDate = n.dayStart && ymd(workDate(n.dayStart)) === ymd(workDate(now))
      const fresh = !n.dayStart || !last || (now - last >= s.newDayAfter * 3600e3 && !sameDate)
      return fresh ? { dayStart: now.toISOString(), fresh: true } : n
    },
    snoozesToday: (now, s) => lines(SNOOZES).filter(x => new Date(x.at) >= new Date(st.workDay(now, s).dayStart)),
    addSnooze: (at, reason) => put(SNOOZES, JSON.stringify({ at: at.toISOString(), reason: reason || null }) + '\n', true),
    addDone: (at, prompt) => put(DONE, JSON.stringify({ at: at.toISOString(), prompt }) + '\n', true),
    // whole days since the last d for this prompt, or null
    lastDone(now, prompt) {
      const hit = lines(DONE).filter(x => x.prompt === prompt).at(-1)
      return hit ? Math.round((dayOf(now) - dayOf(new Date(hit.at))) / 864e5) : null
    },
  }
  return st
}

// Past the cutoff, on the work day's own date (so after midnight it's still past it).
export function pastCutoff(now, s, dayStart) {
  if (!s.cutoff) return false
  const d = new Date(dayStart), [h, m] = s.cutoff.split(':').map(Number)
  return now >= new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m)
}

// Should a prompt now open Spur? Returns the reason it shouldn't, or 'due'. day = the work day
// (after this prompt), open = a Spur popup is already up, doneToday = the done metric says so.
export function decide({ now, s, day, open, doneToday }) {
  if (!s.on) return 'off'
  if (!s.prompt) return 'no prompt set (run tally spur setup)'
  if (!s.days.includes(workDate(now).getDay())) return 'off day'
  if (now < new Date(new Date(day.dayStart).getTime() + s.firstAfter * MIN)) return 'warm-up'
  if (pastCutoff(now, s, day.dayStart)) return 'after cutoff'
  if (day.until && now < new Date(day.until)) return day.kind ?? 'snoozed'
  if (day.done) return 'done today'
  if (open) return 'already open'
  if (doneToday) return 'done today'
  return 'due'
}

// A done metric's value counts as done when it's above 0 or true.
export const isDone = v => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && Number(v) > 0)

// The snooze log (off unless spur.log is set): each snooze goes into the work day's note, under
// `## Snoozes`, as `- HH:MM reason` (time only without one). {date} is the work day's YYYY-MM-DD, so a
// snooze after midnight lands in the note of the day it belongs to. A missing note is created.
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function withSnoozes(text, lines) {
  const all = text.split('\n'), at = all.indexOf('## Snoozes')
  if (at === -1) return `${text.replace(/\n*$/, '')}${text.trim() ? '\n\n' : ''}## Snoozes\n${lines.join('\n')}\n`
  let end = at + 1
  while (end < all.length && !all[end].startsWith('## ')) end++
  let last = end; while (last > at + 1 && !all[last - 1].trim()) last--
  all.splice(last, 0, ...lines)
  return all.join('\n')
}
export function logSnooze(template, day, at, reason) {
  const date = ymd(day), p = expand(template.replaceAll('{date}', date))
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const text = existsSync(p) ? readFileSync(p, 'utf8') : `# ${date}\n`
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, withSnoozes(text, [`- ${time}${reason ? ` ${reason}` : ''}`]))
  return p
}
