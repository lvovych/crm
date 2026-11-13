import { describe, expect, it } from 'vitest'
import { payrollWeek, weeklyAmounts } from '@/features/payroll/weekly'

const day = (value: string) => new Date(value + 'T00:00:00Z')
describe('weekly payroll statement', () => {
  it('groups by period end and splits allocated advances from ordinary payments', () => {
    const slips = [
      { end: day('2026-11-08'), total: 525, allocations: [] },
      { end: day('2026-11-15'), total: 700, allocations: [
        { amount: 300, payment: { advance: true } },
        { amount: 50.25, payment: { advance: false } },
      ] },
      { end: day('2026-11-16'), total: 200, allocations: [] },
    ]
    expect(weeklyAmounts(slips, payrollWeek('2026-11-13'))).toEqual({
      count: 1, values: [70000, 30000, 5025, 34975, 52500].map(BigInt),
    })
  })
  it('selects the same Monday across the year boundary and distinguishes missing slips', () => {
    const week = payrollWeek('2027-01-03')
    expect(week.start).toEqual(day('2026-12-28'))
    expect(week.end).toEqual(day('2027-01-03'))
    expect(weeklyAmounts([], week).count).toBe(0)
  })
})
