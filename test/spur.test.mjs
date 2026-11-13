import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { promptLines, focusProblem, block } from '../spur/font.mjs'
import { settings, store, decide, pastCutoff, isDone } from '../spur/state.mjs'
import { checkConfig } from '../src/config.mjs'

const at = s => new Date(s)
const S = settings({ spur: { prompt: 'SHIP THE APP' } })

test('prompt: fits the popup, one or two lines, letters only', () => {
  assert.deepEqual(promptLines('ship the app'), ['SHIP THE APP'])
  assert.equal(promptLines('SEND THE INVOICES TO EVERY CLIENT TODAY').length, 3) // too long marker
  assert.equal(focusProblem('ship the app'), null)
  assert.match(focusProblem('ship it!'), /only A–Z/)
  assert.match(focusProblem('SEND THE INVOICES TO EVERY CLIENT TODAY PLEASE'), /too long/)
  assert.equal(block('A').length, 3)
})

test('decide: warm-up, due, snoozed, done, already open, off', () => {
  const day = { dayStart: '2026-11-13T09:00' }
  assert.equal(decide({ now: at('2026-11-13T09:30'), s: S, day }), 'warm-up')
  assert.equal(decide({ now: at('2026-11-13T09:50'), s: S, day }), 'due')
  assert.equal(decide({ now: at('2026-11-13T10:00'), s: S, day: { ...day, until: '2026-11-13T10:30', kind: 'snooze' } }), 'snooze')
  assert.equal(decide({ now: at('2026-11-13T10:00'), s: S, day: { ...day, done: true } }), 'done today')
  assert.equal(decide({ now: at('2026-11-13T10:00'), s: S, day, doneToday: true }), 'done today')
  assert.equal(decide({ now: at('2026-11-13T10:00'), s: S, day, open: true }), 'already open')
  assert.equal(decide({ now: at('2026-11-13T10:00'), s: { ...S, on: false }, day }), 'off')
  assert.match(decide({ now: at('2026-11-13T10:00'), s: { ...S, prompt: null }, day }), /no prompt/)
})

test('cutoff is measured on the work day\'s own date', () => {
  assert.equal(pastCutoff(at('2026-11-13T21:00'), S, '2026-11-13T09:00'), false)
  assert.equal(pastCutoff(at('2026-11-13T21:45'), S, '2026-11-13T09:00'), true)
  assert.equal(pastCutoff(at('2026-11-14T01:00'), S, '2026-11-13T09:00'), true) // after midnight, same work day
  assert.equal(pastCutoff(at('2026-11-14T01:00'), { ...S, cutoff: null }, '2026-11-13T09:00'), false)
})

test('work day: a 5 hour break starts a new one; snoozes and d are per work day / prompt', () => {
  const st = store(mkdtempSync(join(tmpdir(), 'spur-')))
  assert.equal(st.workDay(at('2026-11-13T09:00'), S).fresh, true)
  st.writeNudge({ dayStart: '2026-11-13T09:00', lastPrompt: '2026-11-14T02:30' })
  assert.equal(st.workDay(at('2026-11-14T03:00'), S).fresh, undefined) // still the 13th's day
  assert.equal(st.workDay(at('2026-11-14T08:30'), S).fresh, true) // 6 h later: new day
  st.addSnooze(at('2026-11-13T23:00'), null)
  st.addSnooze(at('2026-11-14T01:00'), 'tired')
  assert.equal(st.snoozesToday(at('2026-11-14T03:00'), S).length, 2)
  assert.equal(st.snoozesToday(at('2026-11-14T09:00'), S).length, 0)
  st.addDone(at('2026-11-10T12:00'), 'SHIP THE APP')
  assert.equal(st.lastDone(at('2026-11-13T12:00'), 'SHIP THE APP'), 3)
  assert.equal(st.lastDone(at('2026-11-13T12:00'), 'OTHER'), null)
})

test('isDone and config checks', () => {
  assert.equal(isDone(1), true); assert.equal(isDone(0), false); assert.equal(isDone(true), true); assert.equal(isDone(null), false)
  const problems = checkConfig({ metrics: { a: { source: { type: 'file' } } }, spur: { prompt: 'hi!', done: 'b', doneSound: 'x', cutoff: '9pm' } })
  assert.equal(problems.length, 4)
  assert.deepEqual(checkConfig({ metrics: { a: { source: { type: 'file' } } }, spur: { prompt: 'SHIP IT', done: 'a' } }), [])
})

test('popup frames: page, then the done screen, and the test popup records nothing', () => {
  const state = mkdtempSync(join(tmpdir(), 'spur-state-'))
  const env = { ...process.env, XDG_STATE_HOME: state, SPUR_FRAME: '3' }
  const cfg = new URL('../examples/freelancer.json', import.meta.url).pathname
  const run = extra => execFileSync('node', ['bin/tally.mjs', 'spur', 'test', '--config', cfg], { env: { ...env, ...extra }, cwd: new URL('..', import.meta.url).pathname }).toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  assert.match(run({}), /s {2}snooze {4}d {2}done/)
  assert.match(run({ SPUR_DONE: '2' }), /██████╗ {2}██████╗ ███╗/)
  assert.equal(existsSync(join(state, 'tally', 'spur')) ? readdirSync(join(state, 'tally', 'spur')).length : 0, 0)
})
