// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  calculateCommissions,
  type CommissionOrder,
} from '@/features/payroll/commission-calculator'
import { rulesAt, type CommissionRule } from '@/features/payroll/commission-rules'
import { Prisma } from '@/generated/prisma/client'
const rule = (
  basis: CommissionRule['basis'],
  rate: string,
  extra: Partial<CommissionRule> = {}
): CommissionRule => ({
  id: basis,
  ruleKey: basis,
  basis,
  name: basis,
  scope: basis === 'labor' ? 'performer' : 'manager',
  rate,
  effective: '2026-11-01',
  createdAt: '2026-11-01T00:00:00Z',
  enabled: true,
  afterDiscount: true,
  deductMechanicPay: true,
  deductSubcontractCost: true,
  includeNegative: false,
  ...extra,
})
function fixture() {
  const order: CommissionOrder = {
    id: 'o',
    title: 'Order',
    invoiceNumber: '1048',
    vehicle: null,
    status: 'completed',
    payrollEarnedAt: new Date('2026-11-09T10:00:00Z'),
    subtotal: 15000,
    discountAmount: 0,
    taxInclusive: false,
    taxRate: 0,
    payAssignment: { ownerId: 'manager', partsId: 'seller' },
    laborItems: [
      {
        id: 'l',
        description: 'Робота',
        total: 5000,
        hours: 1,
        technicianId: 'mechanic',
        subcontract: null,
      },
    ],
    partItems: [
      {
        id: 'p',
        name: 'Деталь',
        total: 10000,
        unitPrice: 10000,
        quantity: 1,
        unitCost: 7000,
        payrollSellerId: null,
      },
    ],
  }
  const rules = {
    manager: [rule('managerLabor', '5'), rule('partsMargin', '10')],
    mechanic: [rule('labor', '40')],
  }
  const input = {
    orders: [order],
    rules,
    employee: 'manager',
    start: '2026-11-09',
    end: '2026-11-15',
    zone: 'Europe/Kyiv',
  }
  return { input, order, rules, run: () => calculateCommissions(input) }
}
describe('Individual commissions on closed orders', () => {
  it('rejects reversed periods and respects employment boundaries', () => {
    const { input, run } = fixture()
    expect(() => calculateCommissions({ ...input, start: '2026-12-01' })).toThrow()
    expect(calculateCommissions({ ...input, hiredOn: '2026-11-10' }).total).toBe('0.00')
    expect(calculateCommissions({ ...input, dismissedOn: '2026-11-08' }).total).toBe('0.00')
    expect(
      calculateCommissions({ ...input, hiredOn: '2026-11-01', dismissedOn: '2026-11-30' }).total
    ).toBe(run().total)
    expect(calculateCommissions({ ...input, employee: 'unknown' }).total).toBe('0.00')
  })
  it('allocates seller sales only to their own lines, with order-level fallback', () => {
    const { input, order } = fixture()
    const rules = { seller: [rule('partsSales', '10', { scope: 'seller', afterDiscount: false })] }
    order.partItems.push({ ...order.partItems[0], id: 'other', payrollSellerId: 'other' })
    const run = () => calculateCommissions({ ...input, employee: 'seller', rules })
    expect(run().total).toBe('1000.00')
    order.payAssignment = null
    expect(run().total).toBe('0.00')
    order.partItems[0].payrollSellerId = 'seller'
    expect(run().total).toBe('1000.00')
  })
  it('calculates whole-order margin and clamps the whole loss, not each losing part', () => {
    const { input, order } = fixture()
    const rules = { manager: [rule('orderMargin', '10', { deductMechanicPay: false })] }
    order.partItems[0].unitCost = 11000
    const run = () => calculateCommissions({ ...input, rules })
    expect(run().total).toBe('400.00')
    order.laborItems[0].total = 500
    expect(run().total).toBe('0.00')
    rules.manager[0].includeNegative = true
    expect(run().total).toBe('-50.00')
  })
  it('uses full bases before discounts, handles zero subtotal and records fallback identifiers', () => {
    const { input, order, rules } = fixture()
    rules.mechanic[0].afterDiscount = false
    order.subtotal = 0
    order.discountAmount = 500
    order.invoiceNumber = null
    order.vehicle = { make: 'A', model: 'B', licensePlate: 'AA' }
    const result = calculateCommissions({ ...input, employee: 'mechanic' })
    expect(result.total).toBe('2000.00')
    expect(result.lines[0]).toMatchObject({ order: 'Order · o', car: 'A B AA' })
  })
  it('requires an unambiguous mechanic before calculating net manager income', () => {
    const { order, run } = fixture()
    order.laborItems[0].technicianId = null
    expect(run).toThrow('Призначте механіка')
    order.laborItems[0].assignmentIssue = 'Ambiguous'
    expect(run).toThrow('Ambiguous')
  })
  it('allows contractor revenue before costs and correctly handles no returned cost', () => {
    const { rules, order, run } = fixture()
    order.laborItems[0].subcontract = { unitCost: new Prisma.Decimal(1000), returnedCost: null }
    expect(run().total).toBe('500.00')
    rules.manager[0].deductSubcontractCost = false
    expect(run().total).toBe('550.00')
  })
  it('allows whole-workshop management without making the manager a mechanic', () => {
    const { input, order, rules, run } = fixture()
    order.payAssignment = null
    rules.manager = rules.manager.map((r) => ({ ...r, scope: 'workshop' }))
    expect(run().total).toBe('450.00')
    expect(calculateCommissions({ ...input, employee: 'mechanic' }).total).toBe('2000.00')
    rules.manager = rules.manager.map((r) => ({ ...r, scope: 'manager' }))
    expect(run().total).toBe('0.00')
  })
  it('does not count shop fees as a mechanic job or require their executor', () => {
    const { input, order, run } = fixture()
    order.laborItems[0].pricingType = 'shopFee'
    expect(calculateCommissions({ ...input, employee: 'mechanic' }).total).toBe('0.00')
    expect(run().total).toBe('550.00')
  })
  it('itemizes manager parts margin and work after mechanic commission', () => {
    const { run } = fixture(),
      result = run()
    expect(result.lines.map((l) => [l.kind, l.base, l.amount])).toEqual([
      ['labor', '3000.00', '150.00'],
      ['parts', '3000.00', '300.00'],
    ])
    expect(result.total).toBe('450.00')
    expect(result.lines[0]).toMatchObject({
      orderId: 'o',
      lineId: 'l',
      cost: '2000.00',
      effective: '2026-11-01',
    })
  })
  it('pays a mechanic only for own non-outsourced work', () => {
    const { input, order, run } = fixture()
    input.employee = 'mechanic'
    expect(run().total).toBe('2000.00')
    order.laborItems[0].technicianId = 'other'
    expect(run().total).toBe('0.00')
    order.laborItems[0].technicianId = 'mechanic'
    order.laborItems[0].subcontract = { unitCost: new Prisma.Decimal(500), returnedCost: null }
    expect(run().total).toBe('0.00')
  })
  it.each([
    ['2026-11-08T21:59:59Z', '0.00'],
    ['2026-11-08T22:00:00Z', '450.00'],
    ['2026-11-15T21:59:59Z', '450.00'],
    ['2026-11-15T22:00:00Z', '0.00'],
  ])('uses closure local day inclusively: %s', (date, expected) => {
    const { order, run } = fixture()
    order.payrollEarnedAt = new Date(date)
    expect(run().total).toBe(expected)
  })
  it('excludes open orders even with an old completion stamp', () => {
    const { order, run } = fixture()
    order.status = 'in_progress'
    expect(run().total).toBe('0.00')
    order.status = 'completed'
    order.payrollEarnedAt = null
    expect(run().total).toBe('0.00')
  })
  it('selects both employee and mechanic historical rates at closure, including suspension', () => {
    const { rules, order, run } = fixture()
    rules.mechanic.push(rule('labor', '50', { id: 'new', effective: '2026-11-12' }))
    rules.manager.push(
      rule('partsMargin', '10', { id: 'pause', effective: '2026-11-12', enabled: false })
    )
    expect(run().total).toBe('450.00')
    order.payrollEarnedAt = new Date('2026-11-13')
    expect(run().total).toBe('125.00')
    expect(rulesAt(rules.manager, '2026-10-31')).toHaveLength(0)
  })
  it('supports independent rates and explicit bases before mechanic pay', () => {
    const { rules, run } = fixture()
    rules.manager[0].deductMechanicPay = false
    expect(run().total).toBe('550.00')
  })
  it('requires cost and mechanic rates rather than overstating manager income', () => {
    const { rules, order, run } = fixture()
    rules.mechanic = []
    expect(run).toThrow('Немає відсотка механіка')
    rules.manager[0].deductMechanicPay = false
    order.partItems[0].unitCost = 0
    expect(run).toThrow('собівартість')
  })
  it('applies tax and discounts before commission, rounding displayed amounts', () => {
    const { input, order, run } = fixture()
    input.employee = 'mechanic'
    order.taxInclusive = true
    order.taxRate = 20
    order.laborItems[0].total = 6000
    order.subtotal = 16000
    order.discountAmount = 1600
    expect(run().total).toBe('1800.00')
  })
  it('accounts for contractor costs and returns, never charging mechanic pay twice', () => {
    const { order, run } = fixture()
    order.laborItems[0].subcontract = {
      unitCost: new Prisma.Decimal(1000),
      returnedCost: new Prisma.Decimal(200),
    }
    expect(run().lines[0].amount).toBe('210.00')
  })
  it('clamps negative part margin unless explicitly configured', () => {
    const { rules, order, run } = fixture()
    order.partItems[0].unitCost = 11000
    expect(run().total).toBe('150.00')
    rules.manager[1].includeNegative = true
    expect(run().total).toBe('50.00')
  })
})
