import { describe, it, expect } from 'vitest'
import { periodPresets, presetPeriod, type PeriodPreset } from '@/features/payroll/period-presets'
describe('Salary calendar periods', () => {
  it.each([
    ['currentWeek', '2026-11-16', '2026-11-22'],
    ['previousWeek', '2026-11-09', '2026-11-15'],
    ['currentFortnight', '2026-11-09', '2026-11-22'],
    ['currentMonth', '2026-11-01', '2026-11-30'],
    ['previousMonth', '2026-10-01', '2026-10-31'],
  ])('fills %s for the workshop day', (key, start, end) => {
    expect(presetPeriod(key as PeriodPreset, '2026-11-21')).toEqual({ start, end })
    expect(periodPresets[key as PeriodPreset]).toBeTruthy()
  })
  it.each([
    ['currentWeek', '2026-11-22', '2026-11-16', '2026-11-22'],
    ['currentWeek', '2026-11-23', '2026-11-23', '2026-11-29'],
    ['currentFortnight', '2027-01-01', '2026-12-21', '2027-01-03'],
    ['previousMonth', '2027-01-31', '2026-12-01', '2026-12-31'],
    ['currentMonth', '2028-02-29', '2028-02-01', '2028-02-29'],
    ['previousMonth', '2028-03-31', '2028-02-01', '2028-02-29'],
  ])('handles calendar boundaries %s %s', (key, today, start, end) => {
    expect(presetPeriod(key as PeriodPreset, today)).toEqual({ start, end })
  })
})
