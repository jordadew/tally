// Spur's settings, state and the rules for when it fires. State lives in Tally's state folder
// (~/.local/state/tally/spur/), never in the config; settings come from the config's "spur" block.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stateDir } from '../src/config.mjs'

export const DEFAULTS = {
  on: true, prompt: null, done: null, since: null,
  firstAfter: 45, snooze: 45, reasonFrom: 2, cutoff: null, newDayAfter: 5,
}
export const settings = cfg => ({ ...DEFAULTS, ...(cfg.spur ?? {}) })

const MIN = 60_000
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
    // The work day starts at the first prompt after a break of newDayAfter hours, so working past
    // midnight still counts as the day before. fresh = no prompt yet since that break.
    workDay(now, s) {
      const n = st.readNudge(), last = n.lastPrompt ? new Date(n.lastPrompt) : null
      const fresh = !n.dayStart || !last || now - last >= s.newDayAfter * 3600e3
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
