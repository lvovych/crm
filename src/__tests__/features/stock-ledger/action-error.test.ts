import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ledgerActionError } from '@/features/stock-ledger/Lib/actionError'
describe('ledger error contract', () => {
  it('identifies the exact row/field without returning invalid input', () => {
    const parsed = z
      .object({ lines: z.array(z.object({ quantity: z.number().positive() })) })
      .safeParse({ lines: [{ quantity: -1 }] })
    if (parsed.success) throw new Error('Expected failure')
    const error = ledgerActionError(parsed.error)
    expect(error.code).toBe('VALIDATION')
    expect(error.fields[0].field).toBe('lines.0.quantity')
    expect(error.fields[0]).not.toHaveProperty('input')
  })
  it('does not expose database/runtime diagnostics', () => {
    expect(ledgerActionError(new TypeError('sensitive path'))).toEqual({
      code: 'INTERNAL',
      fields: [],
    })
    expect(ledgerActionError(new Error('Insufficient stock'))).toEqual({
      code: 'OPERATION_REJECTED',
      fields: [],
    })
  })
})
