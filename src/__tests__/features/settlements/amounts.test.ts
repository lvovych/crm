import { describe, expect, it } from 'vitest'
import {
  dueOn,
  suggestedDistribution,
  activeOn,
  hryvnia,
  kopecks,
  remaining,
  splitPayment,
} from '@/features/settlements/amounts'
import { storedLineAmount, receiptTotal } from '@/features/receipts/money'
const event = (amount: string, d: string, rev: string | null = null) => ({
  amount,
  date: new Date(d),
  reversedAt: rev ? new Date(rev) : null,
})
describe('supplier settlement precision', () => {
  it.each([
    '0',
    '0.00',
    '0.01',
    '0.1',
    '1.00',
    '999999999999999999.99',
  ])('round-trips %s through integer kopecks', (v) =>
    expect(kopecks(hryvnia(kopecks(v)))).toBe(kopecks(v)))
  it.each([
    '',
    '-1',
    '0.001',
    '1.005',
    '1e2',
    'NaN',
    'Infinity',
  ])('rejects unpayable values %s', (v) => expect(() => kopecks(v)).toThrow())
  it('retains every kopeck on either side of a debt boundary', () => {
    for (let i = 1; i <= 10000; i++) {
      const debt = BigInt(i)
      for (const diff of [-1, 0, 1]) {
        const payment = debt + BigInt(diff)
        const { applied, advance, open } = splitPayment(payment, debt)
        expect(applied + advance).toBe(payment)
        expect(applied + open).toBe(debt)
        expect(advance * open).toBe(BigInt(0))
        expect(advance >= 0 && open >= 0).toBe(true)
      }
    }
  })
  it('closes the exact rounded document with the last kopeck', () => {
    const amount = storedLineAmount({ quantity: '3', unitPrice: '0.3350' })
    const total = receiptTotal([{ amount }, { amount }])
    expect(total).toBe('2.02')
    const partial = splitPayment(kopecks('2.01'), kopecks(total))
    expect(hryvnia(partial.open)).toBe('0.01')
    expect(splitPayment(BigInt(1), partial.open).open).toBe(BigInt(0))
  })
  it('distinguishes open obligation, free advance and net debt across dates', () => {
    const invoice = event('1150', '2026-10-02'),
      prepayment = event('300', '2026-10-01')
    const applied = event('300', '2026-10-03'),
      partial = event('500', '2026-10-04')
    expect(remaining(invoice, [applied, partial], '2026-10-01')).toBe(BigInt(0))
    expect(
      remaining(invoice, [applied, partial], '2026-10-02') -
        remaining(prepayment, [applied], '2026-10-02')
    ).toBe(BigInt(85000))
    expect(remaining(prepayment, [applied], '2026-10-03')).toBe(BigInt(0))
    expect(remaining(invoice, [applied, partial], '2026-10-04')).toBe(BigInt(35000))
  })
  it('preserves a closed period across reversal at Kyiv midnight', () => {
    const allocation = event('0.01', '2026-11-01', '2026-11-03T22:05:00Z')
    expect(activeOn(allocation, '2026-11-03')).toBe(true)
    expect(activeOn(allocation, '2026-11-04')).toBe(false)
    expect(hryvnia(-kopecks('0.01'))).toBe('-0.01')
  })
})

it('offers oldest-first allocation and retains the spare credit', () => {
  expect(
    suggestedDistribution('1000', [
      { id: 'first', open: '600' },
      { id: 'second', open: '350' },
    ])
  ).toEqual({ first: '600.00', second: '350.00' })
  expect(
    suggestedDistribution('600.01', [
      { id: 'first', open: '600' },
      { id: 'second', open: '350' },
    ])
  ).toEqual({ first: '600.00', second: '0.01' })
})
it('keeps the previous due date for historical overdue reports', () => {
  const changes = [
    { changedAt: new Date('2026-11-03T22:10:00Z'), previous: new Date('2026-11-01') },
  ]
  expect(dueOn(new Date('2026-11-11'), changes, '2026-11-03')).toBe('2026-11-01')
  expect(dueOn(new Date('2026-11-11'), changes, '2026-11-04')).toBe('2026-11-11')
})
