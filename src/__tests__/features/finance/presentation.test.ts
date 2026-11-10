import { describe, it, expect } from 'vitest'
import { moneyLabel, dayLabel, groupMovements } from '@/features/finance/presentation'
describe('cash presentation', () => {
  it.each([
    ['0', '0,00 грн'],
    ['1000.01', '1\u00a0000,01 грн'],
    ['-0.01', '-0,01 грн'],
    ['99999999999999999999.99', '99\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999,99 грн'],
  ])('formats %s exactly', (value, label) => expect(moneyLabel(value)).toBe(label))
  it('formats calendar dates without timezone conversion', () =>
    expect(dayLabel('2026-11-10')).toBe('10.11.2026'))
  it('groups only legs of the same transfer without changing signed single-account rows', () => {
    const debit = { documentId: 't', kind: 'transfer', amount: '-10.01' }
    const credit = { ...debit, amount: '10.01' }
    const other = { documentId: 'other', kind: 'income', amount: '10.01' }
    expect(groupMovements([other, debit, credit])).toEqual([[other], [debit, credit]])
    expect(groupMovements([debit])).toEqual([[debit]])
    expect(groupMovements([debit, { ...credit, documentId: 'different' }])).toHaveLength(2)
  })
})
