// @vitest-environment node
import { it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { calculatePayroll, periodEnd } from '@/features/payroll/calculator'
const D = Prisma.Decimal
it('conserves every kopeck of salary across month halves, leap years and employment boundaries', () => {
  const plan = {
    id: 'plan',
    monthly: new D('1000.01'),
    labor: new D(0),
    partsSales: new D(0),
    partsMargin: new D(0),
    orderMargin: new D(0),
    afterDiscount: true,
    marginAfterDiscount: true,
    includeNegativeOrderMargin: false,
    discountsByBasis: {},
  }
  for (const year of [2024, 2025, 2026])
    for (let month = 0; month < 12; month++) {
      const run = (day: number) => {
        const start = new Date(Date.UTC(year, month, day))
        return calculatePayroll({
          person: {},
          plan,
          orders: [],
          employee: 'e',
          start,
          end: periodEnd(start, 'twice'),
          zone: 'Europe/Kyiv',
        })
      }
      const a = run(1),
        b = run(16)
      expect(new D(a.total).plus(b.total).toFixed(2)).toBe('1000.01')
      expect(a.lines.every((l) => new D(l.amount).gte(0))).toBe(true)
    }
  const start = new Date('2024-02-01'),
    end = new Date('2024-02-29')
  const r = calculatePayroll({
    person: { hiredOn: new Date('2024-02-10'), dismissedOn: new Date('2024-02-20') },
    plan,
    orders: [],
    employee: 'e',
    start,
    end,
    zone: 'UTC',
  })
  expect(r.lines).toHaveLength(11)
  expect(() =>
    calculatePayroll({
      person: {},
      plan,
      orders: [],
      employee: 'e',
      start: end,
      end: start,
      zone: 'UTC',
    })
  ).toThrow()
})
