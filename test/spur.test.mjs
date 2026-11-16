import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { promptLines, focusProblem, block } from '../spur/font.mjs'
import { settings, store, decide, pastCutoff, isDone, logSnooze, daysName } from '../spur/state.mjs'
import { checkConfig } from '../src/config.mjs'

const at = s => new Date(s)
const S = settings({ spur: { prompt: 'SHIP THE APP', cutoff: '21:30' } })

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

test('days: off days never nudge; names read Monday first', () => {
  const sat = { dayStart: '2026-11-14T09:00' }
  assert.equal(decide({ now: at('2026-11-14T10:00'), s: S, day: sat }), 'off day') // weekdays by default
  assert.equal(decide({ now: at('2026-11-14T10:00'), s: { ...S, days: [6, 0] }, day: sat }), 'due')
  const mon = { dayStart: '2026-11-16T00:30' }
  assert.equal(decide({ now: at('2026-11-16T01:30'), s: S, day: mon }), 'off day') // before 06:00 it's still Sunday
  assert.equal(daysName([1, 2, 3, 4, 5]), 'Weekdays')
  assert.equal(daysName([0, 1, 2, 3, 4, 5, 6]), 'Every day')
  assert.equal(daysName([2, 3, 4]), 'Tue–Thu')
  assert.equal(daysName([5, 1, 3]), 'Mon, Wed, Fri')
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
  st.writeNudge({ dayStart: '2026-11-16T09:00', lastPrompt: '2026-11-16T19:30' })
  assert.equal(st.workDay(at('2026-11-17T01:30'), S).fresh, undefined) // 6 h break, but before 06:00: still the 16th
  assert.equal(st.workDay(at('2026-11-17T07:00'), S).fresh, true)
  st.writeNudge({ dayStart: '2026-11-13T09:00', lastPrompt: '2026-11-14T02:30' })
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
  const problems = checkConfig({ metrics: { a: { source: { type: 'file' } } }, spur: { prompt: 'hi!', done: 'b', cutoff: '9pm' } })
  assert.equal(problems.length, 3)
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

test('install adds the prompt hook once, keeps other hooks, and uninstall removes only ours', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-'))
  const { writeFileSync, readFileSync } = await import('node:fs')
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'x', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }))
  const cli = (...a) => execFileSync('node', ['bin/tally.mjs', 'spur', ...a, '--yes', '--config', 'examples/freelancer.json'], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, cwd: new URL('..', import.meta.url).pathname }).toString()
  const hooks = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).hooks.UserPromptSubmit.map(h => h.hooks[0].command)
  cli('install'); cli('install')
  assert.equal(hooks().length, 2)
  assert.match(hooks()[1], /spur\/hook\.sh' '\/.*freelancer\.json'$/) // absolute config path
  cli('uninstall')
  assert.deepEqual(hooks(), ['echo other'])
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).model, 'x')
})

test('sound recipe: every part and mix points at a known source', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../spur/sounds.mjs', import.meta.url), 'utf8')
  const { SOURCES } = await import('../spur/sounds.mjs')
  for (const id of [...src.matchAll(/src: '(\w+)'/g)].map(m => m[1])) assert.ok(SOURCES[id], id)
})

test('tally init can add Spur, checking the wording', async () => {
  const { writeFileSync, readFileSync, mkdtempSync: mk } = await import('node:fs')
  const d = mk(join(tmpdir(), 'init-'))
  writeFileSync(join(d, 'log.md'), `- ${new Date().toISOString().slice(0, 10)} did it\n`)
  execFileSync('node', ['bin/tally.mjs', 'init', '--config', join(d, 'c.json')], { input: `4\n2\n${join(d, 'log.md')}\ny\nship it!\nship the app\n1\n`, cwd: new URL('..', import.meta.url).pathname })
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'c.json'), 'utf8')).spur, { prompt: 'SHIP THE APP', done: 'code_today', since: 'code_since' })
})

test('snooze log: off by default; adds to the work day\'s note, made if missing, keeping what follows', () => {
  assert.equal(settings({ spur: {} }).log, null)
  assert.deepEqual(checkConfig({ metrics: {}, spur: { log: '~/notes/x.md' } }), ['spur.log must be a path with {date} in it, e.g. "~/notes/daily/{date}.md", or null'])
  const dir = mkdtempSync(join(tmpdir(), 'spur-log-')), tpl = join(dir, 'daily', '{date}.md'), day = new Date(2026, 10, 13)
  const p = logSnooze(tpl, day, new Date(2026, 10, 14, 0, 11), 'still on it')
  assert.equal(p, join(dir, 'daily', '2026-11-13.md')) // after midnight: the work day's note
  assert.equal(readFileSync(p, 'utf8'), '# 2026-11-13\n\n## Snoozes\n- 00:11 still on it\n')
  writeFileSync(p, '# 2026-11-13\n\n## Snoozes\n- 09:00\n\n## Notes\nmine\n')
  logSnooze(tpl, day, new Date(2026, 10, 13, 10, 30), null)
  assert.equal(readFileSync(p, 'utf8'), '# 2026-11-13\n\n## Snoozes\n- 09:00\n- 10:30\n\n## Notes\nmine\n')
})
