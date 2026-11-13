// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { periodEnd, calculate } from '@/features/payroll/calculation'
import type { TxClient } from '@/lib/db'

const amount = (n: number) => new Prisma.Decimal(n)
const start = new Date('2026-11-09')
describe('Payroll', () => {
  it('uses calendar half months including leap February', () => {
    expect(periodEnd(new Date('2024-02-16'), 'twice').toISOString().slice(0, 10)).toBe('2024-02-29')
    expect(periodEnd(new Date('2024-02-01'), 'twice').getUTCDate()).toBe(15)
    expect(() => periodEnd(new Date('2024-02-02'), 'monthly')).toThrow()
  })
  it('keeps labor and order margin as two independently discounted components', async () => {
    const plan = {
      id: 'plan',
      effective: start,
      frequency: 'weekly',
      monthly: amount(0),
      labor: amount(50),
      partsMargin: amount(0),
      partsSales: amount(0),
      orderMargin: amount(20),
      afterDiscount: false,
      includeNegativeOrderMargin: false,
      marginAfterDiscount: true,
    }
    const order = {
      id: 'order',
      invoiceNumber: '1842',
      vehicle: null,
      payrollEarnedAt: start,
      subtotal: 2000,
      discountAmount: 200,
      payAssignment: { ownerId: 'emp' },
      laborItems: [{ total: 1400, description: 'Робота', technicianId: 'emp' }],
      partItems: [{ total: 600, unitPrice: 600, quantity: 1, unitCost: 400 }],
    }
    const tx = {
      technician: { findFirstOrThrow: async () => ({ payPlans: [plan] }) },
      serviceRecord: { findMany: async () => [order] },
    } as unknown as TxClient
    const slip = await calculate(tx, 'org', 'emp', start, 'UTC')
    expect(slip.lines.map((l) => l.amount)).toEqual(['700.00', '280.00'])
    expect(slip.total).toBe('980.00')
    const arbitraryStart = new Date('2026-11-10')
    const end = new Date('2026-11-12')
    const later = await calculate(tx, 'org', 'emp', arbitraryStart, 'UTC', end)
    expect(later.end).toEqual(end)
    expect(later.total).toBe('0.00')
    await expect(calculate(tx, 'org', 'emp', end, 'UTC', arbitraryStart)).rejects.toThrow('Кінець')
  })
})

import { prepareParts } from '@/features/vehicles/Lib/saveServiceLines'

function example() {
  const plan = {
    id: 'weekly',
    effective: start,
    frequency: 'weekly',
    monthly: amount(0),
    labor: amount(50),
    partsMargin: amount(0),
    partsSales: amount(0),
    orderMargin: amount(20),
    afterDiscount: false,
    includeNegativeOrderMargin: false,
    marginAfterDiscount: true,
  }
  const person = { payPlans: [plan], dismissedOn: null as Date | null }
  const order = {
    id: 'order',
    invoiceNumber: 'COMBO',
    vehicle: null,
    payrollEarnedAt: start,
    subtotal: 3120.7,
    discountAmount: 0,
    taxInclusive: false,
    taxRate: 0,
    payAssignment: { ownerId: 'emp', partsId: 'other' },
    laborItems: [
      {
        total: 1050,
        description: 'Own labor',
        technicianId: 'emp',
        hours: 1,
        subcontract: null as null | { unitCost: Prisma.Decimal },
      },
      {
        total: 500,
        description: 'Other labor',
        technicianId: 'other',
        hours: 1,
        subcontract: null as null | { unitCost: Prisma.Decimal },
      },
    ],
    partItems: [
      {
        name: 'Part',
        total: 1570.7,
        unitPrice: 1570.7,
        quantity: 1,
        unitCost: 1000,
        payrollSellerId: null as string | null,
      },
    ],
  }
  const tx = {
    technician: { findFirstOrThrow: async () => person },
    serviceRecord: { findMany: async () => [order] },
  } as unknown as TxClient
  return {
    person,
    plan,
    order,
    run: (date = start, zone = 'UTC') => calculate(tx, 'org', 'emp', date, zone),
  }
}
describe('Commission basis and effective dates', () => {
  it('reproduces Carbook and includes another mechanic only in the whole-order margin', async () => {
    const { run } = example()
    const { lines, total } = await run()
    expect(lines.map((l) => [l.name, l.rate, l.base, l.amount])).toEqual([
      ['Own labor', '50%', '1050.00', '525.00'],
      ['Маржа наряду', '20%', '2120.70', '424.14'],
    ])
    expect(total).toBe('949.14')
  })
  it('excludes VAT included in sales before subtracting purchase costs', async () => {
    const { order, run } = example()
    order.taxInclusive = true
    order.taxRate = 20
    order.laborItems[0].total = 1260
    order.laborItems[1].total = 600
    order.partItems[0].total = 1884.84
    expect((await run()).total).toBe('949.14')
  })
  it('subtracts subcontractor cost and skips the personal mechanic commission for outsourced work', async () => {
    const { order, run } = example()
    order.laborItems[0].hours = 2
    order.laborItems[0].subcontract = { unitCost: amount(100) }
    expect((await run()).lines.map((l) => l.amount)).toEqual(['384.14'])
  })
  it('applies seller overrides only to the selected employee and restores the order default', async () => {
    const { order, plan, run } = example()
    plan.partsSales = amount(10)
    plan.partsMargin = amount(5)
    expect((await run()).lines).toHaveLength(2)
    order.partItems[0].payrollSellerId = 'emp'
    expect((await run()).lines.map((l) => l.amount)).toEqual([
      '525.00',
      '157.07',
      '28.54',
      '424.14',
    ])
    order.payAssignment.partsId = 'emp'
    order.partItems[0].payrollSellerId = 'other'
    expect((await run()).lines).toHaveLength(2)
  })
  it('blocks an unknown purchase cost only for a relevant margin rule', async () => {
    const { order, plan, run } = example()
    order.partItems[0].unitCost = 0
    await expect(run()).rejects.toThrow('собівартість')
    plan.orderMargin = amount(0)
    expect((await run()).total).toBe('525.00')
  })
  it('uses the workshop local day at the Sunday/Monday boundary', async () => {
    const { order, run } = example()
    order.payrollEarnedAt = new Date('2026-11-08T22:30:00Z')
    expect((await run(start, 'UTC')).total).toBe('0.00')
    expect((await run(start, 'Europe/Kyiv')).total).toBe('949.14')
  })
  it('uses the current plan for earlier work and excludes work after dismissal', async () => {
    const { order, person, plan, run } = example()
    const change = new Date('2026-11-11')
    person.payPlans.unshift({ ...plan, id: 'new', labor: amount(40), effective: change })
    expect((await run()).lines[0].plan).toBe('new')
    order.payrollEarnedAt = change
    expect((await run()).lines[0].amount).toBe('420.00')
    person.dismissedOn = start
    expect((await run()).total).toBe('0.00')
  })
  it('records current conditions even for an earlier period with no earnings', async () => {
    const { run } = example()
    const slip = await run(new Date('2026-11-02'))
    expect(slip.total).toBe('0.00')
    expect(slip.conditions.join(' ')).toContain('Виконані роботи · 50%')
  })
  it('distributes a monthly salary across unequal halves without losing a cent', async () => {
    const { plan, run } = example()
    plan.effective = new Date('2026-10-01')
    plan.frequency = 'twice'
    plan.monthly = amount(1000)
    const first = await run(new Date('2026-10-01')),
      second = await run(new Date('2026-10-16'))
    expect([first.total, second.total]).toEqual(['483.87', '516.13'])
  })
  it('retains the part seller when a work order saves edited line items', async () => {
    const old = {
      id: 'part',
      name: 'Filter',
      quantity: 1,
      unitPrice: 20,
      total: 20,
      payrollSellerId: 'seller',
    }
    const tx = { servicePart: { findMany: async () => [old] } } as unknown as TxClient
    const [line] = await prepareParts(tx, 'order', [
      { ...old, quantity: 2, unitCost: 5, markupPercent: 0 },
    ])
    expect(line.payrollSellerId).toBe('seller')
    expect(line.total).toBe(40)
  })
})

describe('Order margin edge cases', () => {
  it('rounds each displayed component to cents before adding the payslip total', async () => {
    const { order, run } = example()
    order.laborItems[0].total = 1.01
    order.laborItems[1].total = 0
    order.partItems[0].total = 1.02
    order.partItems[0].unitCost = 1
    const slip = await run()
    expect(slip.lines.map((l) => l.amount)).toEqual(['0.51', '0.21'])
    expect(slip.total).toBe('0.72')
  })
  it.each([
    { includeLoss: false, base: '0.00', commission: '0.00', total: '525.00' },
    { includeLoss: true, base: '-1000.00', commission: '-200.00', total: '325.00' },
  ])('handles a loss with includeNegativeOrderMargin=$includeLoss', async ({
    includeLoss,
    base,
    commission,
    total,
  }) => {
    const { order, plan, run } = example()
    plan.includeNegativeOrderMargin = includeLoss
    order.partItems[0].unitCost = 4120.7
    const slip = await run()
    expect(slip.lines.map((l) => [l.rate, l.base, l.amount])).toEqual([
      ['50%', '1050.00', '525.00'],
      ['20%', base, commission],
    ])
    expect(slip.total).toBe(total)
  })
  it('uses part line discounts and the document discount exactly once', async () => {
    const { order, plan, run } = example()
    order.laborItems = []
    order.partItems[0] = {
      ...order.partItems[0],
      quantity: 2,
      unitPrice: 500,
      total: 900,
      unitCost: 300,
      payrollSellerId: 'emp',
    }
    order.subtotal = 900
    order.discountAmount = 90
    plan.partsSales = amount(10)
    plan.partsMargin = amount(10)
    plan.afterDiscount = true
    expect((await run()).lines.map((l) => [l.base, l.amount])).toEqual([
      ['810.00', '81.00'],
      ['210.00', '21.00'],
      ['210.00', '42.00'],
    ])
    plan.afterDiscount = false
    plan.marginAfterDiscount = false
    expect((await run()).lines.map((l) => l.amount)).toEqual(['100.00', '40.00', '80.00'])
  })
  it('excludes activity outside the period, before employment terms, and for unrelated roles', async () => {
    const { plan, order, run } = example()
    plan.effective = new Date('2026-11-11')
    expect((await run()).lines).toHaveLength(2)
    order.payrollEarnedAt = new Date('2026-11-16')
    expect((await run()).lines).toEqual([])
    order.payrollEarnedAt = new Date('2026-11-12')
    order.payAssignment.ownerId = 'other'
    order.laborItems[0].technicianId = 'other'
    expect((await run()).lines).toEqual([])
  })
})
