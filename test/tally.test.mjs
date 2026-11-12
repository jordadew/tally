import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { windowStart, daysSince, toDate } from '../src/windows.mjs'
import { frontmatter, readMetric, readAll, pick } from '../src/sources.mjs'
import { checkConfig } from '../src/config.mjs'
import { panel, vlen } from '../src/render.mjs'

const NOW = new Date('2026-11-12T15:00') // a Thursday
const ctx = base => ({ now: NOW, weekStart: 'monday', base })

test('windows', () => {
  assert.equal(windowStart('week', NOW).getDate(), 9) // Monday 9 Nov
  assert.equal(windowStart('week', NOW, 'sunday').getDate(), 8)
  assert.equal(windowStart('month', NOW).getDate(), 1)
  assert.equal(windowStart('all', NOW), null)
  assert.equal(daysSince(toDate('2026-11-08'), NOW), 4)
  assert.equal(daysSince(null, NOW), null)
  assert.equal(toDate(1731400000).getUTCFullYear(), 2024) // seconds
})

test('frontmatter and pick', () => {
  assert.deepEqual(frontmatter('---\ntitle: "A b"\nstatus: posted\n---\nbody'), { title: 'A b', status: 'posted' })
  assert.deepEqual(frontmatter('no fm'), {})
  assert.equal(pick({ a: [{ b: 3 }] }, 'a[0].b'), 3)
})

test('folder source: count, window, days_since, first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'))
  mkdirSync(join(dir, 'p'))
  const note = (f, fm) => writeFileSync(join(dir, 'p', f), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`)
  note('a.md', { status: 'posted', posted_at: '2026-11-12' })
  note('b.md', { status: 'posted', posted_at: '2026-11-03' })
  note('c.md', { status: 'filmed', title: 'Gamma' })
  note('d.md', { status: 'planned', title: 'Delta' })
  const m = source => ({ source: { type: 'folder', path: 'p', ...source } })
  assert.equal(await readMetric(m({ where: { status: 'posted' } }), ctx(dir)), 2)
  assert.equal(await readMetric(m({ date: 'posted_at', window: 'today' }), ctx(dir)), 1)
  assert.equal(await readMetric(m({ date: 'posted_at', window: 'week' }), ctx(dir)), 1)
  assert.equal(await readMetric(m({ date: 'posted_at', measure: 'days_since' }), ctx(dir)), 0)
  assert.equal(await readMetric(m({ where: { status: ['planned', 'filmed'] }, measure: 'first', sort: { field: 'status', rank: ['filmed', 'planned'] } }), ctx(dir)), 'Gamma')
})

test('file, json and command sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'))
  writeFileSync(join(dir, 'in.csv'), 'date,amt\n2026-11-02,100\n2026-10-30,50\n2026-11-11,25\n')
  writeFileSync(join(dir, 'd.json'), JSON.stringify({ deals: [{ s: 'open', v: 5 }, { s: 'open', v: 7 }, { s: 'won', v: 9 }] }))
  const c = ctx(dir)
  assert.equal(await readMetric({ source: { type: 'file', path: 'in.csv', pattern: '^(?<date>[\\d-]+),(?<amt>\\d+)$', window: 'month', measure: 'sum', field: 'amt' } }, c), 125)
  assert.equal(await readMetric({ source: { type: 'json', path: 'd.json', key: 'deals' } }, c), 3)
  assert.equal(await readMetric({ source: { type: 'json', path: 'd.json', key: 'deals', where: { s: 'open' }, measure: 'sum', field: 'v' } }, c), 12)
  assert.equal(await readMetric({ source: { type: 'command', run: 'echo 42' } }, c), 42)
  assert.deepEqual(await readMetric({ source: { type: 'command', run: 'printf "a\\nb"', parse: 'lines' } }, c), ['a', 'b'])
  const all = await readAll({ bad: { source: { type: 'command', run: 'echo nope' } } }, c)
  assert.match(all.bad.error, /not a number/)
})

test('config check names every problem', () => {
  const p = checkConfig({ sections: [{ layout: 'grid', metrics: ['x'] }], metrics: { y: {} } })
  assert.equal(p.length, 3)
})

test('every box line is the configured width, hidden or not', () => {
  const cfg = {
    title: 'TALLY', width: 54, currency: '$', metrics: {
      a: { label: 'a long label that will not fit', source: {} }, m: { format: 'money', sensitive: true, source: {} },
      t: { template: 'Do {value}', source: {} }, d: { format: 'days', source: {} },
    },
    sections: [
      { title: 'Progress', layout: 'progress', metric: 'm', target: 1000 },
      { title: 'Strip', layout: 'strip', metrics: ['a', 'm', 'd'] },
      { title: 'Rows', layout: 'rows', metrics: ['a', 'm'] },
      { layout: 'pair', left: { title: 'L', ticks: true, metrics: ['a'] }, right: { title: 'R', metrics: ['m', 'd'] } },
      { title: 'Next', layout: 'list', metrics: ['t'] },
    ],
  }
  const data = { a: { value: 3 }, m: { value: 1234 }, t: { value: 'a very long piece title that goes on and on past the edge of the box' }, d: { value: 0 } }
  for (const hidden of [false, true]) {
    const lines = panel(cfg, data, { now: NOW, hidden, keys: 'q close' }).split('\n').filter(l => /[│╭╰]/.test(l))
    assert.ok(lines.length > 10)
    for (const l of lines) assert.equal(vlen(l), 56, l)
  }
})
