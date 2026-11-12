// Data sources. Each reads data that already exists and returns a number, a Date or text.
// Tally never stores or edits your data; it only counts it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expand } from './config.mjs'
import { inWindow, daysSince, toDate } from './windows.mjs'

const run = promisify(execFile)
/** ~ expands to home; a relative path is relative to the config file. */
const at = (p, ctx) => { const e = expand(p); return isAbsolute(e) ? e : join(ctx.base ?? process.cwd(), e) }

/** a.b[0].c on parsed JSON. */
export function pick(obj, path) {
  if (!path) return obj
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/** ${VAR} from the environment, or from an env file given as source.envFile. */
function subst(str, env) {
  return String(str).replace(/\$\{(\w+)\}/g, (_, k) => {
    const v = env[k] ?? process.env[k]
    if (v == null) throw new Error(`environment variable ${k} is not set`)
    return v
  })
}
function envFile(path, ctx) {
  if (!path) return {}
  const out = {}
  for (const line of readFileSync(at(path, ctx), 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/** Frontmatter between --- lines: flat "key: value" pairs. */
export function frontmatter(text) {
  const fm = {}
  if (!text.startsWith('---')) return fm
  for (const line of text.split('\n').slice(1)) {
    if (line.trim() === '---') break
    const m = /^([\w-]+):\s*(.*)$/.exec(line)
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return fm
}

const matches = (row, where) => Object.entries(where ?? {}).every(([k, want]) => {
  const v = String(row[k] ?? '')
  return Array.isArray(want) ? want.map(String).includes(v) : String(want) === v
})

/**
 * Turn a list of rows into the metric's value.
 * measure: count (default) | sum (field) | days_since (date) | latest (date) | first (field of the first row after sort)
 */
function measureRows(rows, src, ctx) {
  const date = r => (src.date === 'mtime' ? r.__mtime : toDate(r[src.date]))
  let list = rows.filter(r => matches(r, src.where))
  if (src.window && src.date) list = list.filter(r => inWindow(date(r), src.window, ctx.now, ctx.weekStart))
  const m = src.measure ?? 'count'
  if (m === 'count') return list.length
  if (m === 'sum') return list.reduce((s, r) => s + (Number(r[src.field]) || 0), 0)
  if (m === 'days_since' || m === 'latest') {
    const ds = list.map(date).filter(d => d && !Number.isNaN(+d))
    const last = ds.length ? new Date(Math.max(...ds)) : null
    return m === 'latest' ? last : daysSince(last, ctx.now)
  }
  if (m === 'first') {
    if (src.sort) {
      const { field, order = 'asc', rank } = src.sort
      const key = r => (rank ? rank.indexOf(r[field]) : r[field] ?? '')
      list = [...list].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * (order === 'desc' ? -1 : 1))
    }
    return list.length ? String(list[0][src.field ?? 'title'] ?? '') : null
  }
  throw new Error(`unknown measure "${m}"`)
}

const SOURCES = {
  /** Any shell command. Prints a number, lines of text, or JSON (with key). */
  async command(src, ctx) {
    const { stdout } = await run('/bin/sh', ['-c', src.run], { timeout: (src.timeout ?? 10) * 1000, maxBuffer: 16 << 20, env: { ...process.env, ...envFile(src.envFile, ctx) }, cwd: ctx.base })
    const out = stdout.trim()
    if (src.parse === 'json') return pick(JSON.parse(out), src.key)
    if (src.parse === 'lines') return out ? out.split('\n') : []
    if (src.parse === 'text') return out
    const n = Number(out)
    if (out === '' || Number.isNaN(n)) throw new Error(`command printed "${out.slice(0, 40)}", not a number (set "parse": "text" or "lines" for text)`)
    return n
  },

  /** A folder of notes: one row per file, from its frontmatter (plus __mtime). */
  async folder(src, ctx) {
    const dir = at(src.path, ctx), ext = src.ext ?? '.md'
    const rows = readdirSync(dir).filter(f => extname(f) === ext).map(f => {
      const full = join(dir, f)
      return { title: f.slice(0, -ext.length), ...frontmatter(readFileSync(full, 'utf8')), __mtime: statSync(full).mtime }
    })
    return measureRows(rows, src, ctx)
  },

  /** Lines in a text file matching a regex. A named group (?<date>…) lets the window apply. */
  async file(src, ctx) {
    const re = new RegExp(src.pattern, src.flags ?? '')
    const rows = readFileSync(at(src.path, ctx), 'utf8').split('\n').map(l => re.exec(l)).filter(Boolean)
      .map(m => ({ ...m.groups, title: m.groups?.title ?? m[0] }))
    return measureRows(rows, { date: rows.some(r => r.date) ? 'date' : undefined, ...src }, ctx)
  },

  /** A local JSON file: a value at key, or rows (an array) to measure. */
  async json(src, ctx) {
    const v = pick(JSON.parse(readFileSync(at(src.path, ctx), 'utf8')), src.key)
    return Array.isArray(v) && (src.measure || src.where || src.window) ? measureRows(v, src, ctx) : Array.isArray(v) ? v.length : v
  },

  /** A JSON API. Headers and URL can use ${ENV_VAR}; keys never go in the config. */
  async http(src, ctx) {
    const env = envFile(src.envFile, ctx)
    const headers = Object.fromEntries(Object.entries(src.headers ?? {}).map(([k, v]) => [k, subst(v, env)]))
    const r = await fetch(subst(src.url, env), { headers, signal: AbortSignal.timeout((src.timeout ?? 10) * 1000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const v = pick(await r.json(), src.key)
    return Array.isArray(v) && (src.measure || src.where || src.window) ? measureRows(v, src, ctx) : Array.isArray(v) ? v.length : v
  },

  /** Commits in a git repo. */
  async git(src, ctx) {
    const repo = at(src.repo ?? '.', ctx)
    if (!existsSync(repo)) throw new Error(`no repo at ${repo}`)
    const args = ['-C', repo, 'log', '--format=%cI']
    if (src.author) args.push(`--author=${src.author}`)
    if (src.path) args.push('--', src.path)
    const { stdout } = await run('git', args, { maxBuffer: 64 << 20 })
    const rows = stdout.split('\n').filter(Boolean).map(t => ({ date: t }))
    return measureRows(rows, { date: 'date', ...src }, ctx)
  },
}

/** One readable line: a command's own stderr beats Node's "Command failed: …" wrapper. */
const errorText = e => (String(e?.stderr ?? '').trim().split('\n').filter(Boolean).pop() || String(e?.message ?? e).split('\n')[0]).replace(/^fatal:\s*/, '')

export const SOURCE_TYPES = Object.keys(SOURCES)

export async function readMetric(metric, ctx) {
  const fn = SOURCES[metric.source.type]
  if (!fn) throw new Error(`unknown source type "${metric.source.type}" (use ${SOURCE_TYPES.join(', ')})`)
  return fn(metric.source, ctx)
}

/** Every metric at once. Each result is { value } or { error }. */
export async function readAll(metrics, ctx) {
  const ids = Object.keys(metrics)
  const res = await Promise.allSettled(ids.map(id => readMetric(metrics[id], ctx)))
  return Object.fromEntries(ids.map((id, i) => [id, res[i].status === 'fulfilled'
    ? { value: res[i].value instanceof Date ? res[i].value.toISOString() : res[i].value }
    : { error: errorText(res[i].reason) }]))
}
