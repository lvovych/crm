import { describe, expect, it } from 'vitest'
import { returnSchema } from '@/features/receipts/return-ledger'
import { availableQuantity } from '@/features/receipts/transfer-schema'
const valid = {
  id: 'aef56586-425b-4a80-bd4c-b4c1518db6e7',
  receiptId: 'receipt',
  reason: 'Інше',
  lines: [{ id: 'line', quantity: '0.001' }],
}
describe('supplier return validation', () => {
  it('accepts fractional quantities and trims the reason', () => {
    expect(returnSchema.parse({ ...valid, reason: ' Інше ' }).reason).toBe('Інше')
  })
  it.each([
    '0',
    '-1',
    'NaN',
    '1e2',
    '0.0001',
    '1000000000',
    '',
  ])('rejects quantity %s', (quantity) => {
    expect(returnSchema.safeParse({ ...valid, lines: [{ id: 'line', quantity }] }).success).toBe(
      false
    )
  })
  it.each([
    { ...valid, reason: ' ' },
    { ...valid, reason: 'Arbitrary reason' },
    { ...valid, supplierDocumentNumber: 'x'.repeat(121) },
    { ...valid, supplierId: 'supplier' },
    { ...valid, receiptId: undefined },
    { ...valid, reason: 'a'.repeat(1001) },
    { ...valid, lines: [] },
    { ...valid, lines: [...valid.lines, ...valid.lines] },
    { ...valid, id: 'invalid' },
  ])('rejects invalid document %#', (input) => {
    expect(returnSchema.safeParse(input).success).toBe(false)
  })
  it('keeps exact remaining quantity after fractional returns and transfers', () => {
    expect(availableQuantity('1', ['0.1', '0.2'])).toBe('0.700')
    expect(availableQuantity('1', ['0.1', '0.2', '0.7'])).toBe('0.000')
  })
})
