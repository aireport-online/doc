const time = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
const weekdayDay = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
const number = new Intl.NumberFormat('nl-NL')

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const daysAgo = (ms: number, now = Date.now()) => Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)

export const formatTime = (ms: number) => time.format(ms)
export const formatNumber = (n: number) => number.format(n)

/** "Vandaag", "Gisteren" or the full date: used as the heading of a day in the version history. */
export function formatDay(ms: number): string {
  const days = daysAgo(ms)
  if (days === 0) return 'Vandaag'
  if (days === 1) return 'Gisteren'
  const label = new Date(ms).getFullYear() === new Date().getFullYear() ? weekdayDay.format(ms) : dayMonthYear.format(ms)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** A moment in words for recent ones and as a date for older ones. */
export function formatMoment(ms: number): string {
  const days = daysAgo(ms)
  if (days === 0) return `Vandaag ${time.format(ms)}`
  if (days === 1) return `Gisteren ${time.format(ms)}`
  if (new Date(ms).getFullYear() === new Date().getFullYear()) return `${dayMonth.format(ms)} ${time.format(ms)}`
  return dayMonthYear.format(ms)
}

export const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} en ${names[names.length - 1]}`
}
