import { describe, expect, it } from 'vitest'
import { lineCents, receiptTotal, storedLineAmount } from '@/features/receipts/money'
describe('UAH receipt line amounts', () => {
  it.each([
    ['1', '0', '0.00'],
    ['0.001', '0.0001', '0.00'],
    ['1', '0.0049', '0.00'],
    ['1', '0.0050', '0.01'],
    ['1', '0.0051', '0.01'],
    ['1', '1.005', '1.01'],
    ['1', '2.675', '2.68'],
    ['1', '9.995', '10.00'],
    ['1', '99.9999', '100.00'],
    ['3', '0.0049', '0.01'],
    ['0.499', '0.01', '0.00'],
    ['0.500', '0.01', '0.01'],
    ['0.501', '0.01', '0.01'],
    ['0.333', '3.0000', '1.00'],
    ['0.100', '0.1000', '0.01'],
    ['987654321.123', '9876543.0178', '9754610389287364.70'],
  ])('%s × %s = %s', (quantity, unitPrice, expected) => {
    expect(storedLineAmount({ quantity, unitPrice })).toBe(expected)
  })
  it('checks all 10,000 four-place prices below one hryvnia against decimal half-up', () => {
    for (let digits = 0; digits < 10000; digits++) {
      const fraction = String(digits).padStart(4, '0')
      const expected = Number(fraction.slice(0, 2)) + Number(fraction[2] >= '5')
      expect(lineCents({ quantity: '1', unitPrice: '0.' + fraction })).toBe(BigInt(expected))
    }
  })
  it.each([
    ['', '1'],
    ['1', ''],
    ['1', '-1'],
    ['1', '1.00001'],
    ['1.0001', '1'],
    ['1', '1e2'],
  ])('rejects invalid input %s × %s', (quantity, unitPrice) => {
    expect(lineCents({ quantity, unitPrice })).toBeNull()
    expect(() => storedLineAmount({ quantity, unitPrice })).toThrow()
  })
  it('rejects an amount outside the database precision', () => {
    expect(() =>
      storedLineAmount({ quantity: '999999999.999', unitPrice: '999999999.9999' })
    ).toThrow(/перевищує/)
  })
  it('adds rounded lines rather than rounding the raw document total', () => {
    const amount = storedLineAmount({ quantity: '1', unitPrice: '0.005' })
    expect(receiptTotal([{ amount }, { amount }])).toBe('0.02')
  })
  it('retains a single kopeck in a maximum-size 200-line document', () => {
    const lines = Array.from({ length: 199 }, () => ({ amount: '9999999999999999.99' }))
    expect(receiptTotal([...lines, { amount: '0.01' }])).toBe('1989999999999999998.02')
  })
})
