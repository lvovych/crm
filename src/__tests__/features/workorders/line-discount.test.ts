import { describe, it, expect } from 'vitest'
import { discountedPartTotal, partPriceChanged } from '@/features/vehicles/Lib/lineDiscount'
import { calculateTotals, discountAmountFor } from '@/lib/tax'
describe('work order line discounts', () => {
  it('rounds fractional quantities before discount and applies fixed discount once per row', () => {
    expect(
      discountedPartTotal({
        quantity: 2.5,
        unitPrice: 101.13,
        discountType: 'fixed',
        discountValue: 20,
      })
    ).toBe(232.83)
    expect(
      discountedPartTotal({
        quantity: 2,
        unitPrice: 100,
        discountType: 'percentage',
        discountValue: 10,
      })
    ).toBe(180)
  })
  it.each([-1, 101, Infinity, NaN])('rejects invalid percentage %s', (value) =>
    expect(() =>
      discountedPartTotal({
        quantity: 1,
        unitPrice: 100,
        discountType: 'percentage',
        discountValue: value,
      })
    ).toThrow())
  it('rejects a fixed discount greater than the row', () =>
    expect(() =>
      discountedPartTotal({ quantity: 0, unitPrice: 100, discountType: 'fixed', discountValue: 1 })
    ).toThrow())
  it('supports free rows and 100% discount', () => {
    expect(discountedPartTotal({ quantity: 0, unitPrice: 100 })).toBe(0)
    expect(
      discountedPartTotal({
        quantity: 3,
        unitPrice: 100,
        discountType: 'percentage',
        discountValue: 100,
      })
    ).toBe(0)
  })
  it('applies order discount after line discounts, then tax', () => {
    const subtotal =
      discountedPartTotal({
        quantity: 2,
        unitPrice: 100,
        discountType: 'percentage',
        discountValue: 10,
      }) + 100
    expect(
      calculateTotals({
        subtotal,
        discountAmount: discountAmountFor(subtotal, 'percentage', 10),
        taxRate: 20,
        taxInclusive: false,
      }).totalAmount
    ).toBe(302.4)
  })
  it('does not consider absent discount fields a money change', () =>
    expect(
      partPriceChanged(
        { quantity: 2, unitPrice: 100, discountType: 'none', discountValue: 0 },
        { quantity: 2, unitPrice: 100 }
      )
    ).toBe(false))
})
