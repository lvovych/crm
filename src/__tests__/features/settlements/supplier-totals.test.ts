import { describe, expect, it } from 'vitest'
import { supplierTotals } from '@/features/settlements/amounts'

const row = (kind: string, open: string, overdue = false) => ({ kind, open, overdue })

describe('supplier amounts payable', () => {
  it('shows a debt reduction against an invoice separately from an advance', () => {
    expect(supplierTotals([row('receipt', '10000', true), row('adjustment_credit', '2000')]))
      .toEqual({ debt: '8000.00', advance: '0.00', net: '8000.00', overdue: '8000.00' })
  })
  it('preserves excess correction as a signed balance', () => {
    expect(supplierTotals([row('opening_debt', '100'), row('adjustment_credit', '100.01')]))
      .toMatchObject({ debt: '0.00', advance: '0.00', net: '-0.01' })
  })
  it('counts only unused payments and opening advances, and uses open amounts after allocation', () => {
    expect(supplierTotals([row('receipt', '600'), row('adjustment_debt', '90'),
      row('adjustment_credit', '0'), row('payment', '100'), row('opening_credit', '50')]))
      .toMatchObject({ debt: '540.00', advance: '150.00', net: '540.00' })
  })
  it('offsets overdue balances first and leaves later obligations payable', () => {
    expect(supplierTotals([row('receipt', '100', true), row('receipt', '600'),
      row('adjustment_credit', '80'), row('payment', '30')]))
      .toMatchObject({ debt: '590.00', overdue: '0.00' })
  })
})
