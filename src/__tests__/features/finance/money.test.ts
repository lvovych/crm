import { describe, it, expect } from 'vitest'
import {
  cents,
  decimal,
  normalizeMoney,
  assertHistoricalBalance,
  transactionInput,
} from '@/features/finance/money'
describe('exact cash amounts', () => {
  it.each([
    ['0.01', BigInt('1')],
    ['100', BigInt('10000')],
    ['99999999999999999999.99', BigInt('9999999999999999999999')],
    ['-1.01', -BigInt('101')],
  ])('parses %s exactly', (s, n) => {
    expect(cents(s)).toBe(n)
    expect(cents(decimal(n))).toBe(n)
  })
  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '1.001',
    '0.009',
    '1.',
    '--1',
    '',
    '100000000000000000000.00',
  ])('rejects %s', (v) => expect(() => cents(v)).toThrow())
  it.each([
    ['1 234,56', '1234.56'],
    [' 10,5 ', '10.50'],
    ['1\u00a0000,01', '1000.01'],
  ])('normalizes UI input %s', (v, result) => expect(normalizeMoney(v)).toBe(result))
  it('adds small payments without floating point drift', () =>
    expect(
      decimal(
        Array.from({ length: 1000 }, () => cents('0.01')).reduce((a, b) => a + b, BigInt('0'))
      )
    ).toBe('10.00'))
  it.each(['0', '-1'])('rejects a nonpositive payment %s', (amount) =>
    expect(
      transactionInput.safeParse({
        requestId: '73ab5670-049f-427a-a2e9-53f81e405582',
        kind: 'income',
        date: '2026-11-10',
        amount,
        note: 'test',
      }).success
    ).toBe(false))
})
describe('historical balance boundaries', () => {
  const rows = [
    { date: '2026-11-01', amount: '100.00' },
    { date: '2026-11-03', amount: '-80.00' },
    { date: '2026-11-05', amount: '100.00' },
  ]
  it('rejects a backdated withdrawal despite a sufficient current balance', () =>
    expect(() => assertHistoricalBalance(rows, '2026-11-02', -BigInt('3000'))).toThrow(
      '2026-11-03'
    ))
  it('allows the exact available balance', () =>
    expect(() => assertHistoricalBalance(rows, '2026-11-02', -BigInt('2000'))).not.toThrow())
  it('checks a day with no previous movements', () =>
    expect(() => assertHistoricalBalance([], '2026-11-02', -BigInt('1'))).toThrow())
  it('allows an incoming transfer', () =>
    expect(() => assertHistoricalBalance(rows, '2026-11-02', BigInt('100'))).not.toThrow())
})
