// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseFixed, formatFixed, roundScaled } from '@/lib/exact-money'
import { roundMoney, roundAsPrinted } from '@/lib/money'
describe('exact decimal arithmetic', () => {
  it('round trips signed values at every supported scale without losing a minor unit', () => {
    for (let scale = 0; scale <= 7; scale++)
      for (const n of [
        BigInt(0),
        BigInt(1),
        BigInt(-1),
        BigInt('9999999999999999999999'),
        BigInt('-9999999999999999999999'),
      ])
        expect(parseFixed(formatFixed(n, scale), scale, { wholeDigits: 30 })).toBe(n)
  })
  it.each([
    '',
    'NaN',
    'Infinity',
    '1e2',
    '+1',
    '1.',
    '1.001',
    '--1',
    ' 1',
    '100000000000000000000.00',
  ])('rejects invalid ledger input %s', (value) => expect(() => parseFixed(value)).toThrow())
  it('enforces unsigned quantities and their own precision', () => {
    expect(parseFixed('0.001', 3, { signed: false })).toBe(BigInt(1))
    expect(() => parseFixed('-0.001', 3, { signed: false })).toThrow()
    expect(() => parseFixed('1000000000', 3, { wholeDigits: 9 })).toThrow()
  })
  it('rounds positive and negative ties symmetrically', () => {
    for (let i = 0; i < 1000; i++) {
      const n = BigInt(i)
      expect(roundScaled(-n, BigInt(100))).toBe(-roundScaled(n, BigInt(100)))
    }
    expect(roundScaled(BigInt(49), BigInt(100))).toBe(BigInt(0))
    expect(roundScaled(BigInt(50), BigInt(100))).toBe(BigInt(1))
    expect(() => roundScaled(BigInt(1), BigInt(0))).toThrow()
  })
  it('rejects unsupported scale definitions', () => {
    for (const scale of [-1, 8, 1.5]) {
      expect(() => parseFixed('1', scale)).toThrow()
      expect(() => formatFixed(BigInt(1), scale)).toThrow()
    }
    expect(() => parseFixed('1', 2, { wholeDigits: 0 })).toThrow()
  })
  it('retains the distinction between new arithmetic and historical printed amounts', () => {
    expect(roundMoney(2.5 * 19.99)).toBe(49.98)
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(0.22499999999999998)).toBe(0.23)
    expect(roundAsPrinted(0.22499999999999998)).toBe(0.22)
  })
})
