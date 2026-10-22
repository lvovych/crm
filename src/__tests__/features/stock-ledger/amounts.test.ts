// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { calculateLine, fifo, lineSchema } from '@/features/stock-ledger/Lib/amounts'
describe('precise purchase amounts', () => {
  it('rounds half up without binary floats', () => {
    const r = calculateLine(
      lineSchema.parse({ inventoryPartId: 'p', quantity: '3', unitPrice: '0.335' })
    )
    expect(r.totalAmount.toFixed(2)).toBe('1.01')
  })
  it('treats an amount discount as the whole line', () => {
    const r = calculateLine(
      lineSchema.parse({
        inventoryPartId: 'p',
        quantity: '10',
        unitPrice: '200',
        discountType: 'AMOUNT',
        discountValue: '100',
      })
    )
    expect(r.totalAmount.toFixed(2)).toBe('1900.00')
  })
  it('extracts included tax without increasing the total', () => {
    const r = calculateLine(
      lineSchema.parse({
        inventoryPartId: 'p',
        quantity: '2',
        unitPrice: '120',
        taxMode: 'INCLUSIVE',
        taxRate: '20',
      })
    )
    expect(r.netAmount.toFixed(2)).toBe('200.00')
    expect(r.taxAmount.toFixed(2)).toBe('40.00')
    expect(r.totalAmount.toFixed(2)).toBe('240.00')
  })
  it('rejects over-discount and fractions beyond quantity precision', () => {
    expect(() =>
      calculateLine(
        lineSchema.parse({
          inventoryPartId: 'p',
          quantity: '1',
          unitPrice: '10',
          discountType: 'PERCENT',
          discountValue: '101',
        })
      )
    ).toThrow()
    expect(() =>
      lineSchema.parse({ inventoryPartId: 'p', quantity: '0.0001', unitPrice: '10' })
    ).toThrow()
  })
  it('retains original FIFO cost across lots', () => {
    const r = fifo('4', [
      { id: 'a', available: '2', unitCost: '100' },
      { id: 'b', available: '3', unitCost: '120' },
    ])
    expect(r.map((a) => a.cost)).toEqual(['200.000000', '240.000000'])
    expect(() => fifo('6', [{ id: 'a', available: '5', unitCost: '1' }])).toThrow()
  })
})
it('reads an unlinked saved receipt line with a null purchase reference', () => {
  const line = lineSchema.parse({
    inventoryPartId: 'p',
    purchaseOrderLineId: null,
    quantity: '10',
    unitPrice: '200',
  })
  expect(calculateLine(line).totalAmount.toFixed(2)).toBe('2000.00')
})
