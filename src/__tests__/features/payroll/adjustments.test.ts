import { describe, it, expect } from 'vitest'
import {
  adjustmentsSchema,
  snapshotAdjustments,
  withAdjustments,
} from '@/features/payroll/adjustments'
import { details } from './ui-fixtures'
const bonus = {
  id: 'd4152be8-333d-4a3f-af23-01ba055ad338',
  type: 'bonus' as const,
  amount: '125.50',
  reason: 'Якість роботи',
}
const deduction = {
  ...bonus,
  id: '8bd970c1-b8dd-45c8-ab7a-58db5d8962a3',
  type: 'deduction' as const,
  amount: '25.25',
}
describe('Salary adjustments', () => {
  it('adds bonuses and subtracts deductions exactly once', () => {
    const result = withAdjustments(details, [bonus, deduction])
    expect(result.total).toBe('600.25')
    expect(withAdjustments(result, [bonus, deduction])).toEqual(result)
    expect(withAdjustments(result, [])).toEqual(details)
    expect(snapshotAdjustments(result)).toEqual([bonus, deduction])
  })
  it('supports adjustment-only and negative documents without hiding the deduction', () => {
    expect(withAdjustments({ ...details, lines: [] }, [bonus]).total).toBe('125.50')
    expect(withAdjustments(details, [{ ...deduction, amount: '700' }]).total).toBe('-200.00')
  })
  it('normalizes decimal commas and explanation whitespace', () => {
    expect(
      adjustmentsSchema.parse([{ ...bonus, amount: '1 234,50', reason: ' Премія ' }])[0]
    ).toMatchObject({ amount: '1234.50', reason: 'Премія' })
  })
  it.each([
    undefined,
    null,
    [],
    {},
    { version: 2 },
  ])('reads legacy snapshots without additions: %j', (input) => {
    expect(snapshotAdjustments(input)).toEqual([])
  })
  it.each([
    '0',
    '-1',
    '0.001',
    'NaN',
    'Infinity',
    '1000000000',
    '',
  ])('rejects invalid adjustment amounts %s', (amount) => {
    expect(adjustmentsSchema.safeParse([{ ...bonus, amount }]).success).toBe(false)
  })
  it('rejects duplicate rows, unknown types, invalid IDs and missing explanations', () => {
    for (const rows of [
      [bonus, bonus],
      [{ ...bonus, type: 'other' }],
      [{ ...bonus, id: 'bad' }],
      [{ ...bonus, reason: ' ' }],
      Array.from({ length: 101 }, () => bonus),
    ])
      expect(adjustmentsSchema.safeParse(rows).success).toBe(false)
    expect(() => snapshotAdjustments({ adjustments: 'invalid' })).toThrow()
  })
})
