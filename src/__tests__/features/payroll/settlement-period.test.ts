// @vitest-environment node
import { it, expect } from 'vitest'
import { settlementPeriod } from '@/features/payroll/settlement-queries'
it('bounds detail reads while keeping a deterministic inclusive default period', () => {
  expect(settlementPeriod('2026-04-01')).toEqual({ from: '2026-01-02', to: '2026-04-01' })
  expect(() => settlementPeriod('2026-04-01', '2026-05-01')).toThrow()
  expect(() => settlementPeriod('2026-04-01', '2024-01-01')).toThrow()
  expect(() => settlementPeriod('2026-04-01', 'bad')).toThrow()
})
