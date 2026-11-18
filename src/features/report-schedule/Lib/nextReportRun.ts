import { shiftWorkshopTime } from '@/lib/workshop-datetime'
import { atZonedTime } from '@/lib/timezone'

/** The next run is 08:00 on the workshop's clock, one period on from `current`. */
export function nextReportRun(current: Date, frequency: string, timeZone: string): Date {
  let next = current
  switch (frequency) {
    case 'daily':
      next = shiftWorkshopTime(current, { days: 1 }, timeZone)
      break
    case 'weekly':
      next = shiftWorkshopTime(current, { days: 7 }, timeZone)
      break
    case 'biweekly':
      next = shiftWorkshopTime(current, { days: 14 }, timeZone)
      break
    case 'monthly':
      next = shiftWorkshopTime(current, { months: 1 }, timeZone)
      break
    case 'bimonthly':
      next = shiftWorkshopTime(current, { months: 2 }, timeZone)
      break
    case 'quarterly':
      next = shiftWorkshopTime(current, { months: 3 }, timeZone)
      break
    case 'semiannually':
      next = shiftWorkshopTime(current, { months: 6 }, timeZone)
      break
    case 'yearly':
      next = shiftWorkshopTime(current, { years: 1 }, timeZone)
      break
  }
  return atZonedTime(next, '08:00', timeZone)
}
