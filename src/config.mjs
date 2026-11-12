// Loads and checks the config. Everything Tally shows is defined here; nothing is built in.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const HOME = homedir()
export const expand = p => (p?.startsWith('~') ? join(HOME, p.slice(1)) : p)

export function configPath(argv = process.argv) {
  const i = argv.indexOf('--config')
  if (i > -1 && argv[i + 1]) return expand(argv[i + 1])
  if (process.env.TALLY_CONFIG) return expand(process.env.TALLY_CONFIG)
  return join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'tally', 'config.json')
}

export const stateDir = () => join(process.env.XDG_STATE_HOME || join(HOME, '.local', 'state'), 'tally')

const LAYOUTS = ['strip', 'rows', 'pair', 'progress', 'list']

export function loadConfig(path) {
  if (!existsSync(path)) throw new Error(`No config at ${path}. Run "tally init" (or the /tally-setup skill in Claude Code), or copy one from examples/.`)
  const cfg = JSON.parse(readFileSync(path, 'utf8'))
  const problems = checkConfig(cfg)
  if (problems.length) throw new Error(`Config problems in ${path}:\n  - ${problems.join('\n  - ')}`)
  return {
    title: 'TALLY', width: 54, currency: '$', weekStart: 'monday', ...cfg,
    metrics: cfg.metrics ?? {}, sections: cfg.sections ?? [],
  }
}

export function checkConfig(cfg) {
  const out = [], metrics = cfg.metrics ?? {}
  const need = (id, where) => { if (!metrics[id]) out.push(`${where} uses metric "${id}", which isn't defined under "metrics"`) }
  for (const [id, m] of Object.entries(metrics)) {
    if (!m.source?.type) out.push(`metric "${id}" has no source.type`)
  }
  ;(cfg.sections ?? []).forEach((s, i) => {
    const where = `section ${i + 1}${s.title ? ` ("${s.title}")` : ''}`
    if (!LAYOUTS.includes(s.layout)) out.push(`${where}: layout must be one of ${LAYOUTS.join(', ')}`)
    if (s.layout === 'pair') {
      for (const side of ['left', 'right']) {
        if (!s[side]?.metrics?.length) out.push(`${where}: pair needs ${side}.metrics`)
        else s[side].metrics.forEach(id => need(id, where))
      }
    } else if (s.layout === 'progress') {
      if (!s.metric) out.push(`${where}: progress needs "metric"`)
      else need(s.metric, where)
      if (!(s.target > 0)) out.push(`${where}: progress needs a "target" above 0`)
    } else {
      if (!s.metrics?.length) out.push(`${where}: needs "metrics"`)
      else s.metrics.forEach(id => need(id, where))
    }
  })
  return out
}
