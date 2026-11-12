// Writes a small made-up dataset next to this file, dated relative to today, so examples/creator.json
// shows real-looking numbers straight away:  node examples/demo/make.mjs && tally --config examples/creator.json
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// Content pieces: one note each, frontmatter says where it is.
const posts = join(here, 'posts')
rmSync(posts, { recursive: true, force: true }); mkdirSync(posts, { recursive: true })
const pieces = [
  ['Desk setup tour', 'posted', { planned_at: day(9), filmed_at: day(6), posted_at: day(4) }],
  ['Three apps I use daily', 'posted', { planned_at: day(12), filmed_at: day(10), posted_at: day(8) }],
  ['Morning routine', 'filmed', { planned_at: day(3), filmed_at: day(0) }],
  ['What I spent this month', 'planned', { planned_at: day(0) }],
  ['Coffee gear ranked', 'planned', { planned_at: day(1) }],
  ['Q&A from comments', 'idea', {}],
]
for (const [title, status, dates] of pieces) {
  const fm = Object.entries({ title, status, ...dates }).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(posts, `${title.toLowerCase().replace(/\W+/g, '-')}.md`), `---\n${fm}\n---\n\nNotes for "${title}".\n`)
}

// Money in: one line per payment.
writeFileSync(join(here, 'income.csv'), ['date,source,amount', `${day(20)},Brand A,400`, `${day(5)},Brand B,650`, `${day(2)},Affiliate,85`].join('\n') + '\n')

// Brand deals, as an app might export them.
writeFileSync(join(here, 'deals.json'), JSON.stringify({ deals: [
  { brand: 'Northwind', status: 'open', offer: 900, last_inbound: day(6) },
  { brand: 'Contoso', status: 'open', offer: 450, last_inbound: day(2) },
  { brand: 'Fabrikam', status: 'open', offer: null, last_inbound: day(1) },
  { brand: 'Globex', status: 'declined', offer: 300, last_inbound: day(15) },
] }, null, 2) + '\n')

// Replies sent: a plain log, one line per email.
writeFileSync(join(here, 'replies.md'), [`- ${day(3)} Replied to Globex`, `- ${day(1)} Replied to Contoso`, `- ${day(0)} Replied to Fabrikam`].join('\n') + '\n')

console.log(`Demo data written to ${here}`)
