// @vitest-environment node
import { expect, it } from 'vitest'
import { lineMatcher } from '@/features/vehicles/Lib/lineMatcher'
it('preserves FIFO legacy duplicates, explicit IDs and one-use matching', () => {
  const rows = [
    { id: 'a', key: 'same' },
    { id: 'b', key: 'same' },
    { id: 'c', key: 'other' },
  ]
  const match = lineMatcher(rows, (r) => r.key)
  expect(match('b', 'ignored')).toBe(rows[1])
  expect(match(undefined, 'same')).toBe(rows[0])
  expect(match(undefined, 'same')).toBeUndefined()
  expect(match('b', 'same')).toBeUndefined()
  expect(match('foreign', 'other')).toBeUndefined()
  expect(match(undefined, 'other')).toBe(rows[2])
  expect(match(undefined, 'missing')).toBeUndefined()
})
