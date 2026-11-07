import { describe, it, expect } from 'vitest'
import {
  availableQuantity,
  quantityUnits,
  transferSchema,
} from '@/features/receipts/transfer-schema'
import { storedLineAmount } from '@/features/receipts/money'
const valid = {
  receiptId: 'r',
  serviceRecordId: 's',
  requestId: 'fb273968-409f-46cc-ae0e-e502578ef1be',
  lines: [{ id: 'l', quantity: '1', unitPrice: '1.005' }],
}
describe('receipt transfer validation and arithmetic', () => {
  it('accepts single and multiple rows', () => {
    expect(transferSchema.parse(valid).lines).toHaveLength(1)
    expect(
      transferSchema.parse({ ...valid, lines: [...valid.lines, { ...valid.lines[0], id: 'l2' }] })
        .lines
    ).toHaveLength(2)
  })
  it('rejects duplicate lines', () =>
    expect(
      transferSchema.safeParse({ ...valid, lines: [...valid.lines, ...valid.lines] }).success
    ).toBe(false))
  it.each([
    '0',
    '-1',
    '0.0001',
    '1e3',
    'NaN',
    '',
    '1000000000',
  ])('rejects invalid quantity %s', (quantity) =>
    expect(
      transferSchema.safeParse({ ...valid, lines: [{ ...valid.lines[0], quantity }] }).success
    ).toBe(false))
  it.each(['-1', '1.00001', 'NaN', '1e2'])('rejects invalid price %s', (unitPrice) =>
    expect(
      transferSchema.safeParse({ ...valid, lines: [{ ...valid.lines[0], unitPrice }] }).success
    ).toBe(false))
  it('does not accumulate binary rounding errors for partial transfers', () => {
    expect(availableQuantity('1', ['0.1', '0.2', '0.699'])).toBe('0.001')
    expect(availableQuantity('1', ['0.1', '0.2', '0.7'])).toBe('0.000')
    expect(() => availableQuantity('1', ['1.001'])).toThrow()
  })
  it('rounds customer line prices at half a kopeck', () => {
    expect(storedLineAmount({ quantity: '1', unitPrice: '1.005' })).toBe('1.01')
    expect(storedLineAmount({ quantity: '0.001', unitPrice: '5' })).toBe('0.01')
    expect(storedLineAmount({ quantity: '0.001', unitPrice: '4.9999' })).toBe('0.00')
  })
  it('retains every thousandth for 1000 sequential partial quantities', () => {
    expect(availableQuantity('1', Array(1000).fill('0.001'))).toBe('0.000')
    expect(quantityUnits('999999999.999').toString()).toBe('999999999999')
  })
})
