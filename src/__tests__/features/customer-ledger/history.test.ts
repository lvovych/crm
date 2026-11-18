// @vitest-environment node
import { it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { customerLedgerEvent: { findMany: mocks.read } } }))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: any, options: any) => {
    expect(options.requiredPermissions).toEqual([{ action: 'read', subject: 'billing' }])
    return { success: true, data: await fn({ organizationId: 'allowed' }) }
  },
}))
import { documentHistory } from '@/features/customer-ledger/history'
it('scopes every page by tenant, document, cutoff and cursor', async () => {
  mocks.read.mockResolvedValue([])
  expect((await documentHistory('doc', '2026-01-01', '42')).data).toEqual({
    events: [],
    next: null,
  })
  expect(mocks.read).toHaveBeenCalledWith({
    where: {
      organizationId: 'allowed',
      documentId: 'doc',
      effectiveDate: { lte: new Date('2026-01-01') },
      id: { lt: BigInt(42) },
    },
    orderBy: { id: 'desc' },
    take: 51,
  })
  await expect(documentHistory('doc', 'bad')).rejects.toThrow()
  await expect(documentHistory('doc', '2026-01-01', '-1')).rejects.toThrow()
})
