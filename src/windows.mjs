// Time windows a metric can count over: today, week, month, all.
export const DAY = 86_400_000
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function windowStart(window, now, weekStart = 'monday') {
  const sod = startOfDay(now)
  if (window === 'today') return sod
  if (window === 'week') {
    const back = weekStart === 'sunday' ? now.getDay() : (now.getDay() + 6) % 7
    return new Date(sod.getTime() - back * DAY)
  }
  if (window === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null // all time
}

export const inWindow = (date, window, now, weekStart) => {
  if (!date || Number.isNaN(+date)) return false
  const from = windowStart(window, now, weekStart)
  return (!from || date >= from) && date <= now
}

export const daysSince = (date, now) => (date ? Math.max(0, Math.floor((startOfDay(now) - startOfDay(date)) / DAY)) : null)

/** "2026-11-12", "2026-11-12T10:00Z", or a Unix time in seconds or ms. */
export function toDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v
  if (typeof v === 'number' || /^\d+$/.test(v)) { const n = +v; return new Date(n < 1e12 ? n * 1000 : n) }
  const s = String(v).trim()
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00` : s)
}
