// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { recurringTotals } from '@/features/billing/Lib/recurringTotals'
import { calculateNextRunDate } from '@/features/billing/Lib/recurringExecution'
const template = {
  cost: 0,
  taxRate: 0,
  taxInclusive: false,
  taxComponents: null,
  templateParts: [{ name: 'Part', partNumber: null, quantity: 2.5, unitPrice: 19.99 }],
  templateLabor: [{ description: 'Labor', hours: 2.5, rate: 19.99, pricingType: 'fixed' }],
}
describe('recurring invoice amounts', () => {
  it('sums the rounded persisted rows instead of their unrounded products', () => {
    const result = recurringTotals(template)
    expect(result.parts[0].total).toBe(49.98)
    expect(result.labor[0]).toMatchObject({ total: 49.98, pricingType: 'fixed' })
    expect(result.subtotal).toBe(99.96)
    expect(result.totalAmount).toBe(99.96)
  })
  it.each([false, true])('keeps split taxes and cost consistent, inclusive=%s', (taxInclusive) => {
    const r = recurringTotals({
      ...template,
      cost: 0.105,
      taxInclusive,
      taxComponents: [
        { name: 'A', rate: 5 },
        { name: 'B', rate: 9.975 },
      ],
    })
    expect(r.cost).toBe(0.11)
    expect(r.subtotal).toBe(100.07)
    expect(Math.round(r.taxComponents!.reduce((s, c) => s + c.amount, 0) * 100)).toBe(
      Math.round(r.taxAmount * 100)
    )
    expect(Math.round(r.totalAmount * 100)).toBe(
      Math.round(r.subtotal * 100) + (taxInclusive ? 0 : Math.round(r.taxAmount * 100))
    )
  })
  it('refuses a corrupt frequency instead of repeatedly billing the same period', () => {
    expect(() => calculateNextRunDate(new Date(), 'invalid', 'UTC')).toThrow()
  })
  it('defaults historical labor without a pricing type to hourly', () => {
    const r = recurringTotals({
      ...template,
      templateParts: [],
      templateLabor: [{ description: 'Old labor', hours: 1, rate: 10 }],
    })
    expect(r.labor[0].pricingType).toBe('hourly')
    expect(r.totalAmount).toBe(10)
  })
})
