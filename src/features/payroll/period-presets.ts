export const periodPresets = {
  currentWeek: 'Поточний тиждень',
  previousWeek: 'Минулий тиждень',
  currentFortnight: 'Поточні 2 тижні',
  currentMonth: 'Поточний місяць',
  previousMonth: 'Минулий місяць',
} as const
export type PeriodPreset = keyof typeof periodPresets

/** `today` is already the workshop's local calendar day, not the browser's day. */
export function presetPeriod(preset: PeriodPreset, today: string) {
  const day = new Date(today + 'T00:00:00Z')
  const start = new Date(day),
    end = new Date(day)
  if (preset === 'currentMonth' || preset === 'previousMonth') {
    const offset = preset === 'previousMonth' ? -1 : 0
    start.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth() + offset, 1)
    end.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth() + offset + 1, 0)
  } else {
    const monday = day.getUTCDate() - ((day.getUTCDay() + 6) % 7)
    start.setUTCDate(monday - (preset === 'currentWeek' ? 0 : 7))
    end.setUTCDate(monday + (preset === 'previousWeek' ? -1 : 6))
  }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
