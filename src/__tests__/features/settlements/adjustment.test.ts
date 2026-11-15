// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { operation, applyOperation } from '@/features/settlements/operations'
import { isCredit } from '@/features/settlements/amounts'
import type { TxClient } from '@/lib/db'

const input = { op: 'adjustment', kind: 'adjustment_credit', date: '2026-01-01', amount: '1200.00', note: 'Акт звірки №34' }
describe('supplier adjustment', () => {
  it.each([['adjustment_credit', true], ['adjustment_debt', false]])('posts %s on the correct side', async (kind, credit) => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: "supplier" }]), supplierEntry: { findFirst: vi.fn(), create } }
    await applyOperation(tx as unknown as TxClient, 'org', 'supplier', 'owner', 'doc', operation.parse({ ...input, kind }))
    const entry = create.mock.calls[0][0].data
    expect(entry).toMatchObject({ kind, amount: input.amount, note: input.note, supplierId: 'supplier', createdById: 'owner' })
    expect(isCredit(entry.kind)).toBe(credit)
  })
  it('requires a reason and a positive difference', () => {
    expect(operation.safeParse({ ...input, note: ' ' }).success).toBe(false)
    expect(operation.safeParse({ ...input, amount: '0' }).success).toBe(false)
  })
})
