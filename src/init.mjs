// tally init: a short question-and-answer setup. Asks what to tally and where that data already lives,
// counts it live so you can see it's right, then writes a config. For a guided setup that also helps
// choose which numbers are worth showing, use the Claude Code skill in skills/tally-setup.
import { createInterface } from 'node:readline/promises'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expand } from './config.mjs'
import { readAll, frontmatter } from './sources.mjs'
import { panel } from './render.mjs'

const AREAS = [
  { id: 'money', name: 'Money earned', label: 'earned', money: true },
  { id: 'content', name: 'Content (planned, made, posted)', label: 'posted' },
  { id: 'sales', name: 'Sales, deals or clients', label: 'replies' },
  { id: 'code', name: 'Code shipped', label: 'commits' },
  { id: 'habits', name: 'Habits or workouts', label: 'done' },
  { id: 'writing', name: 'Writing', label: 'written' },
]
const KINDS = [
  ['folder', 'A folder of notes, one note per item (Obsidian, markdown)'],
  ['file', 'One file with a line per item and a date on each line (CSV, a markdown log)'],
  ['git', 'A git repository'],
  ['command', 'A command that prints the number (any app with a CLI)'],
  ['none', "Nowhere yet"],
]
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export async function init(path) {
  // One line reader for typed and piped answers alike (rl.question drops piped lines that arrive early).
  const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY })
  const lines = rl[Symbol.asyncIterator]()
  const ask = async (q, def = '') => {
    process.stdout.write(`${q}${def ? ` [${def}]` : ''} `)
    const { value, done } = await lines.next()
    if (done) { console.log('\nSetup stopped: no more input.'); process.exit(1) }
    if (!process.stdin.isTTY) console.log(value)
    return value.trim() || def
  }
  const choose = async (q, opts) => {
    opts.forEach((o, i) => console.log(`  ${i + 1}. ${o}`))
    for (;;) { const n = +(await ask(q)); if (n >= 1 && n <= opts.length) return n - 1 }
  }
  const now = new Date(), metrics = {}, sections = []

  console.log('\nTally counts what is already in your data and shows it in one panel.')
  console.log('It never stores or edits anything; it only counts.\n')
  if (existsSync(path) && (await ask(`A config already exists at ${path}. Replace it? (y/N)`, 'n')).toLowerCase() !== 'y') { rl.close(); return }

  console.log('What do you want to keep a tally of? Numbers separated by commas, or type your own.')
  AREAS.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`))
  const picked = (await ask('Areas:', '1,2')).split(',').map(s => s.trim()).filter(Boolean)
    .map(s => (/^\d+$/.test(s) ? AREAS[+s - 1] : { id: slug(s), name: s, label: 'done' })).filter(Boolean)

  for (const area of picked) {
    console.log(`\n── ${area.name} ──\nWhere does this data live now?`)
    const kind = KINDS[await choose('Pick one:', KINDS.map(k => k[1]))][0]
    const ids = []
    const add = (id, m) => { metrics[`${area.id}_${id}`] = m; ids.push(`${area.id}_${id}`) }

    if (kind === 'none') {
      const file = expand(`~/tally/${area.id}.md`)
      console.log(`\nTally needs somewhere to count from. The simplest is a plain log, one line per item:\n\n  - ${now.toISOString().slice(0, 10)} ${area.money ? '650 Brand B' : 'what you did'}\n\nAny notes app or editor can add to it.`)
      if ((await ask(`Create ${file} with that format? (Y/n)`, 'y')).toLowerCase() !== 'y') continue
      if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `# ${area.name}\n\n<!-- One line per item: - YYYY-MM-DD ${area.money ? 'amount note' : 'note'} -->\n`) }
      const pattern = area.money ? '^- (?<date>\\d{4}-\\d{2}-\\d{2}) (?<amount>[\\d.]+)' : '^- (?<date>\\d{4}-\\d{2}-\\d{2}) '
      addLog(add, area, file, pattern)
    } else if (kind === 'folder') {
      const dir = await askPath(ask, 'Folder path:', true)
      const notes = readdirSync(dir).filter(f => f.endsWith('.md'))
      const fields = [...new Set(notes.slice(0, 50).flatMap(f => Object.keys(frontmatter(readFileSync(join(dir, f), 'utf8')))))]
      console.log(`Found ${notes.length} notes.${fields.length ? ` Their frontmatter fields: ${fields.join(', ')}` : ' No frontmatter found; the file date will be used.'}`)
      const date = fields.length ? await ask('Which field holds the date to count by? (or "mtime" for when the file changed)', fields.find(f => /date|_at|posted|done|created/.test(f)) ?? 'mtime') : 'mtime'
      const filter = await ask('Only count notes where a field equals a value? e.g. status=posted (Enter to count all)')
      const where = filter.includes('=') ? Object.fromEntries([filter.split('=').map(s => s.trim())]) : undefined
      const src = { type: 'folder', path: dir, date, ...(where && { where }) }
      add('today', { label: `${area.label} today`, tone: { green: '> 0' }, source: { ...src, window: 'today' } })
      add('week', { label: 'this week', source: { ...src, window: 'week' } })
      add('since', { label: `since ${area.label}`, format: 'days', tone: { red: '>= 7', amber: '>= 3', green: '>= 0' }, source: { ...src, measure: 'days_since' } })
    } else if (kind === 'file') {
      const file = await askPath(ask, 'File path:')
      const sample = readFileSync(file, 'utf8').split('\n').find(l => /\d{4}-\d{2}-\d{2}/.test(l))
      if (sample) console.log(`A line from it: ${sample.slice(0, 70)}`)
      const csv = file.endsWith('.csv')
      let pattern = csv ? '^(?<date>\\d{4}-\\d{2}-\\d{2})' : '(?<date>\\d{4}-\\d{2}-\\d{2})'
      if (area.money && csv) {
        const col = +(await ask('Which column holds the amount? (1 = first)', '3'))
        pattern = `^${Array.from({ length: col }, (_, i) => (i === 0 ? '(?<date>\\d{4}-\\d{2}-\\d{2})' : i === col - 1 ? '(?<amount>[\\d.]+)' : '[^,]*')).join(',')}`
        if (col === 1) pattern = '^(?<amount>[\\d.]+)'
      } else if (area.money) pattern = '(?<date>\\d{4}-\\d{2}-\\d{2})\\D+(?<amount>[\\d.]+)'
      addLog(add, area, file, pattern)
    } else if (kind === 'git') {
      const repo = await askPath(ask, 'Repository path:', true)
      add('today', { label: 'today', tone: { green: '> 0' }, source: { type: 'git', repo, window: 'today' } })
      add('week', { label: 'this week', source: { type: 'git', repo, window: 'week' } })
      add('since', { label: 'since commit', format: 'days', tone: { red: '>= 3', amber: '>= 1', green: '>= 0' }, source: { type: 'git', repo, measure: 'days_since' } })
    } else {
      const run = await ask('Command (must print one number):')
      add('value', { label: area.label, ...(area.money && { format: 'money', sensitive: true }), source: { type: 'command', run } })
    }
    if (!ids.length) continue

    if (area.money && ids.length) {
      const target = +(await ask('Monthly target? (Enter for none)'))
      if (target > 0) sections.push({ title: area.id === 'money' ? 'Earned in {month}' : `${area.name} in {month}`, layout: 'progress', metric: ids.find(i => i.endsWith('_month')) ?? ids[0], target })
      const rest = ids.filter(i => !(target > 0 && i.endsWith('_month')))
      if (rest.length) sections.push({ title: area.name.split(' (')[0], layout: 'strip', metrics: rest })
    } else sections.push({ title: area.name.split(' (')[0], layout: 'strip', metrics: ids })

    // Count it now, so a wrong path or field shows up here rather than later.
    const data = await readAll(Object.fromEntries(ids.map(i => [i, metrics[i]])), { now, weekStart: 'monday', base: dirname(path) })
    console.log('Live count:', ids.map(i => `${metrics[i].label} ${data[i].error ? `ERROR (${data[i].error})` : data[i].value == null ? 'none yet' : JSON.stringify(data[i].value)}`).join(' · '))
  }
  rl.close()
  if (!sections.length) { console.log('\nNothing to tally yet. Run tally init again once your data has a home.'); return }

  const cfg = { title: 'TALLY', currency: '$', weekStart: 'monday', sections, metrics }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
  const data = await readAll(metrics, { now, weekStart: 'monday', base: dirname(path) })
  console.log('\n' + panel({ width: 54, ...cfg }, data, { now, hidden: false, keys: '' }))
  console.log(`\nSaved to ${path}`)
  console.log('Next: "tally preview" to try other layouts per section, "tally check" to see every number, "tally" to open.')
}

/** Money: this month's total and days since. Anything else: today, this week, days since. */
function addLog(add, area, file, pattern) {
  const src = { type: 'file', path: file, pattern }
  if (area.money) {
    add('month', { label: 'this month', format: 'money', sensitive: true, source: { ...src, window: 'month', measure: 'sum', field: 'amount' } })
    add('since', { label: 'since paid', format: 'days', source: { ...src, measure: 'days_since' } })
  } else {
    add('today', { label: `${area.label} today`, tone: { green: '> 0' }, source: { ...src, window: 'today' } })
    add('week', { label: 'this week', source: { ...src, window: 'week' } })
    add('since', { label: `since ${area.label}`, format: 'days', tone: { red: '>= 7', amber: '>= 3', green: '>= 0' }, source: { ...src, measure: 'days_since' } })
  }
}

async function askPath(ask, q, dir = false) {
  for (;;) {
    const p = expand(await ask(q))
    if (p && existsSync(p)) return p
    console.log(`  Can't find ${p || 'that'}. Try again (~ works for your home folder).`)
    void dir
  }
}
