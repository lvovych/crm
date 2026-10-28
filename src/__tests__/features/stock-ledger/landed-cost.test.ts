import { describe, it, expect } from 'vitest'
import { D } from '@/features/stock-ledger/Lib/amounts'
import { distributeCost, receiptTotal } from '@/features/stock-ledger/Lib/landedCost'
describe('landed cost and source total', () => {
  it('allocates every kopeck deterministically without floating point', () => {
    expect(distributeCost('0.02', ['1', '1', '1']).map((v) => v.toFixed(2))).toEqual([
      '0.01',
      '0.01',
      '0.00',
    ])
    expect(
      distributeCost('17.37', ['1', '2', '3'])
        .reduce((s, v) => s.plus(v), D(0))
        .toFixed(2)
    ).toBe('17.37')
    expect(distributeCost('0', ['0', '0']).map((v) => v.toFixed(2))).toEqual(['0.00', '0.00'])
    expect(distributeCost('0.01', ['1', '3']).map((v) => v.toFixed(2))).toEqual(['0.00', '0.01'])
  })
  it('requires explicit exact manual allocation with a zero base', () => {
    expect(() => distributeCost('1', ['0', '0'])).toThrow('Нульова база')
    expect(distributeCost('1', ['0', '0'], ['0.3', '0.7']).map((v) => v.toFixed(2))).toEqual([
      '0.30',
      '0.70',
    ])
    for (const values of [['0.5'], ['0.1', '0.2'], ['-1', '2'], ['0.001', '0.999']])
      expect(() => distributeCost('1', ['0', '0'], values)).toThrow('Ручний')
    expect(() => distributeCost('-1', ['1'])).toThrow('невід’ємна')
    expect(() => distributeCost('0.001', ['1'])).toThrow('копійок')
  })
  it('requires documented one-kopeck adjustment and exact source total', () => {
    const lines = [{ totalAmount: D('1.01') }]
    expect(receiptTotal(lines, '0.02', '-0.01', 'Різниця округлення', '1.02').toFixed(2)).toBe(
      '1.02'
    )
    expect(receiptTotal(lines, '0', '0', '', '1.01').toFixed(2)).toBe('1.01')
    for (const [adjustment, reason] of [
      ['0.02', 'Причина'],
      ['0.01', ''],
      ['0.001', 'Причина'],
    ])
      expect(() => receiptTotal(lines, '0', adjustment, reason)).toThrow('Коригування')
    expect(() => receiptTotal(lines, '0', '0', '', '1.02')).toThrow('не збігається')
    expect(() => receiptTotal([{ totalAmount: D(0) }], '0', '-0.01', 'Причина')).toThrow(
      'від’ємною'
    )
  })
})
