// tally spur install / uninstall: add or remove Spur's prompt hook in Claude Code's settings
// (~/.claude/settings.json). Shows the change and asks first; the old file is kept as settings.json.bak.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { HOME } from '../src/config.mjs'

const SETTINGS = join(process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude'), 'settings.json')
const HOOK = new URL('./hook.sh', import.meta.url).pathname
const isOurs = h => h?.hooks?.some(x => x.command?.includes('spur/hook.sh'))

export async function install(configPath, { remove = false, yes = false } = {}) {
  const cur = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {}
  const list = (cur.hooks?.UserPromptSubmit ?? []).filter(h => !isOurs(h))
  const entry = { hooks: [{ type: 'command', command: `bash '${HOOK}' '${resolve(configPath)}'`, timeout: 5 }] }
  const next = { ...cur, hooks: { ...(cur.hooks ?? {}), UserPromptSubmit: remove ? list : [...list, entry] } }
  if (!next.hooks.UserPromptSubmit.length) delete next.hooks.UserPromptSubmit
  if (JSON.stringify(next) === JSON.stringify(cur)) { console.log(remove ? 'Spur\'s hook isn\'t installed.' : 'Already installed.'); return }
  console.log(remove ? `Remove Spur's prompt hook from ${SETTINGS}.` : `Add to ${SETTINGS}, under hooks.UserPromptSubmit:\n\n${JSON.stringify(entry, null, 2)}\n\nOn every prompt it runs \`tally spur check\` in the background (only inside herdr or tmux).`)
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ok = /^y/i.test(await rl.question('\nGo ahead? [y/N] ')); rl.close()
    if (!ok) { console.log('Nothing changed.'); return }
  }
  mkdirSync(dirname(SETTINGS), { recursive: true })
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.bak`)
  writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + '\n')
  console.log(remove ? 'Removed.' : 'Installed. Spur checks on your next prompt in herdr or tmux.')
}
