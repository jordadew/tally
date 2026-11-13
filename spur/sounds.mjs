// tally spur sounds: fetch Spur's sounds from where they're published and build them on this machine.
// Tally ships only this recipe, never the audio: each clip is downloaded from its source (Freesound or
// Mixkit, under their own licences; credits in spur/CREDITS.md), then cut, levelled and mixed with ffmpeg.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Where each clip comes from. Freesound previews and Mixkit's own preview files.
const FS = (id, user) => `https://cdn.freesound.org/previews/${String(id).slice(0, -3)}/${id}_${user}-hq.mp3`
const MK = id => `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`
export const SOURCES = {
  whip: FS(93100, 1386366), spurs: FS(98816, 1386366), yeehaw: FS(439191, 7268008),
  swish: FS(877976, 19512113), pop: FS(458398, 9159316),
  correct: MK(2870), triad: FS(878602, 19512113), yay: FS(563845, 11121005),
  chime: FS(878601, 19512113), soft: FS(878249, 19512113), rising: MK(951),
}

// The cuts. Each is ffmpeg filters on the downloaded clip, then a level: peak (dB) or mean (dB, peak ≤ -1).
const prep = len => `silenceremove=start_periods=1:start_threshold=-40dB,atrim=0:${len},afade=t=out:st=${len - 0.4}:d=0.4,loudnorm=I=-16:TP=-1.5`
const trim = (len, fade) => `silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:${len},afade=t=out:st=${(len - fade).toFixed(2)}:d=${fade}`
const tail = len => `silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:${len},afade=t=out:st=${(len - 0.35).toFixed(2)}:d=0.35:curve=qsin`
const PARTS = {
  whip: { src: 'whip', af: prep(3), peak: -3 },
  spur: { src: 'spurs', ss: 1.39, t: 0.5, af: 'afade=t=out:st=0.38:d=0.12', peak: -3 }, // the second step's jingle
  yeehaw: { src: 'yeehaw', af: prep(3), peak: -3 },
  swish: { src: 'swish', af: trim(0.5, 0.2), mean: -23.9 },
  pop: { src: 'pop', af: trim(0.45, 0.18), mean: -23.9 },
  correct: { src: 'correct', af: tail(1.6), mean: -23.9 },
  triad: { src: 'triad', af: 'silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:2.2,afade=t=out:st=1.9:d=0.3', mean: -23.9 },
  yay: { src: 'yay', af: 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse,afade=t=out:st=1.81:d=0.6:curve=qsin', mean: -23.9 },
  chime: { src: 'chime', af: tail(1.6), mean: -23.9 },
  soft: { src: 'soft', af: tail(1.6), mean: -23.9 },
  rising: { src: 'rising', af: tail(1.6), mean: -23.9 },
}
// The finished sounds: parts at their times (s), then a final pass. done-* = swish at 0, pop at 0.55
// (the burst), and the named sound at 0.95 as DONE lands.
const done = name => ({ layers: [['swish', 0], ['pop', 0.55], [name, 0.95]], post: 'alimiter=limit=0.9' })
const OUT = {
  spur: { layers: [['whip', 0], ['spur', 0.61], ['yeehaw', 0.82]], post: 'alimiter=limit=0.89,loudnorm=I=-16:TP=-1.5' },
  ...Object.fromEntries(['correct', 'triad', 'yay', 'chime', 'soft', 'rising'].map(n => [`done-${n}`, done(n)])),
}

const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
function volume(file) {
  const out = spawnSync('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr // ffmpeg reports on stderr
  const get = k => Number(out.match(new RegExp(`${k}: (-?[\\d.]+) dB`))?.[1] ?? 0)
  return { mean: get('mean_volume'), peak: get('max_volume') }
}
const has = bin => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true } catch { return false } }

export async function buildSounds(dir, { log = console.log } = {}) {
  if (!has('ffmpeg')) throw new Error('Spur builds its sounds with ffmpeg, which isn\'t installed. macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg. Then run tally spur sounds again.')
  const work = join(dir, '.build')
  mkdirSync(work, { recursive: true })
  for (const [id, url] of Object.entries(SOURCES)) { // download, once
    const file = join(work, `${id}.src.mp3`)
    if (existsSync(file)) continue
    log(`  fetching ${id}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`couldn't download ${id} (${res.status}) from ${url}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  for (const [id, p] of Object.entries(PARTS)) { // cut and level
    const raw = join(work, `${id}.raw.wav`), out = join(work, `${id}.wav`)
    ff([...(p.ss != null ? ['-ss', p.ss, '-t', p.t] : []).map(String), '-i', join(work, `${p.src}.src.mp3`), '-af', p.af, '-ar', '44100', '-ac', '2', raw])
    const v = volume(raw), gain = p.peak != null ? p.peak - v.peak : Math.min(p.mean - v.mean, -1 - v.peak)
    ff(['-i', raw, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '44100', '-ac', '2', out])
  }
  for (const [name, o] of Object.entries(OUT)) { // mix
    const ins = o.layers.flatMap(([p]) => ['-i', join(work, `${p}.wav`)])
    const delays = o.layers.map(([, t], i) => `[${i}]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[a${i}]`).join(';')
    const mix = `${o.layers.map((_, i) => `[a${i}]`).join('')}amix=inputs=${o.layers.length}:normalize=0:duration=longest,${o.post}`
    ff([...ins, '-filter_complex', `${delays};${mix}`, '-ar', '44100', '-b:a', '160k', join(dir, `${name}.mp3`)])
    log(`  built ${name}.mp3`)
  }
  rmSync(work, { recursive: true, force: true })
}
