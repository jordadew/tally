// Writes a small made-up dataset next to this file, dated relative to today (or $TALLY_NOW), so
// examples/freelancer.json shows real-looking numbers straight away:
//   node examples/demo/make.mjs && tally --config examples/freelancer.json
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.env.TALLY_NOW ? new Date(process.env.TALLY_NOW) : new Date()
const day = n => { const d = new Date(base); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// Client jobs: one note each, frontmatter says where it is.
const jobs = join(here, 'jobs')
rmSync(join(here, 'posts'), { recursive: true, force: true }) // older demo folder
rmSync(jobs, { recursive: true, force: true }); mkdirSync(jobs, { recursive: true })
const list = [
  ['Umbrella menu design', 'delivered', { drafted_at: day(9), delivered_at: day(6), invoiced_at: day(5) }],
  ['Initech pitch deck', 'delivered', { drafted_at: day(4), delivered_at: day(1), invoiced_at: day(1) }],
  ['Acme logo refresh', 'drafted', { drafted_at: day(0) }],
  ['Stark annual report', 'drafted', { drafted_at: day(2) }],
  ['Hooli landing page', 'briefed', {}],
]
for (const [title, status, dates] of list) {
  const fm = Object.entries({ title, status, ...dates }).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(jobs, `${title.toLowerCase().replace(/\W+/g, '-')}.md`), `---\n${fm}\n---\n\nNotes for "${title}".\n`)
}

// Money in: one line per invoice.
writeFileSync(join(here, 'invoices.csv'), ['date,client,amount', `${day(15)},Soylent,1800`, `${day(5)},Umbrella,2400`, `${day(1)},Initech,1000`].join('\n') + '\n')

// Quotes sent, as an app might export them.
writeFileSync(join(here, 'quotes.json'), JSON.stringify({ quotes: [
  { client: 'Initech', status: 'open', amount: 2200, last_contact: day(6) },
  { client: 'Wayne', status: 'open', amount: 1500, last_contact: day(2) },
  { client: 'Pied Piper', status: 'open', amount: null, last_contact: day(1) },
  { client: 'Globex', status: 'declined', amount: 900, last_contact: day(15) },
] }, null, 2) + '\n')

// Follow-ups sent: a plain log, one line per email.
writeFileSync(join(here, 'chased.md'), [`- ${day(3)} Chased Globex`, `- ${day(1)} Chased Wayne`, `- ${day(0)} Chased Pied Piper`].join('\n') + '\n')

console.log(`Demo data written to ${here}`)
