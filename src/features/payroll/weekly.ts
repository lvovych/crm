import { cents } from '@/features/finance/money'

export function payrollWeek(day: string) {
  const start = new Date(day + 'T00:00:00Z')
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return { start, end }
}

type Money = { toFixed(digits: number): string }
type Slip = {
  end: Date
  total: Money
  allocations: { amount: Money; payment: { advance: boolean } }[]
}

export function weeklyAmounts(slips: Slip[], week: ReturnType<typeof payrollWeek>) {
  let earned = BigInt(0), advance = BigInt(0), paid = BigInt(0), prior = BigInt(0)
  let count = 0
  for (const slip of slips) {
    if (slip.end > week.end) continue
    const total = cents(slip.total.toFixed(2))
    let outstanding = total
    for (const allocation of slip.allocations) {
      const amount = cents(allocation.amount.toFixed(2))
      outstanding -= amount
      if (slip.end >= week.start) {
        if (allocation.payment.advance) advance += amount
        else paid += amount
      }
    }
    if (slip.end < week.start) prior += outstanding
    else {
      earned += total
      count++
    }
  }
  const due = earned - advance - paid + (prior < 0 ? prior : BigInt(0))
  return { count, values: [earned, advance, paid, due > 0 ? due : BigInt(0), prior > 0 ? prior : BigInt(0)] }
}
