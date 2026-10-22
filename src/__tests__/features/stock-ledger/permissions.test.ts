// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  user: vi.fn(),
  document: vi.fn(),
  balances: vi.fn(),
  count: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedSession: mocks.session,
  getCachedMembership: mocks.member,
}))
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: mocks.user },
    inventoryDocument: { findFirst: mocks.document },
    stockLotBalance: { findMany: mocks.balances, count: mocks.count },
    $transaction: mocks.transaction,
  },
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/realtime/actor.server', () => ({
  runAsActor: (_: unknown, fn: () => unknown) => fn(),
}))
import {
  getLedgerDocument,
  listLedgerStock,
  postReceipt,
  reverseLedgerReceipt,
} from '@/features/stock-ledger/Actions/ledgerActions'
import { D } from '@/features/stock-ledger/Lib/amounts'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STOCK_LEDGER_ENABLED', 'true')
  mocks.session.mockResolvedValue({ user: { id: 'user', name: 'Mechanic' } })
  mocks.user.mockResolvedValue({ isSuperAdmin: false })
  mocks.member.mockResolvedValue({
    organizationId: 'org',
    role: 'member',
    customRole: { isAdmin: false, permissions: [{ action: 'read', subject: 'stock_ledger' }] },
  })
})
afterEach(() => vi.unstubAllEnvs())
it('does not read receipt purchase costs without cost permission', async () => {
  expect((await getLedgerDocument('other-tenant-id')).forbidden).toBe(true)
  expect(mocks.document).not.toHaveBeenCalled()
})
it('does not allow stock readers to post or reverse documents', async () => {
  expect((await postReceipt({})).forbidden).toBe(true)
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect((await reverseLedgerReceipt({})).success).toBe(false)
  consoleError.mockRestore()
  expect(mocks.transaction).not.toHaveBeenCalled()
})
it('returns only quantity fields to a stock reader, always scoped to their organization', async () => {
  mocks.count.mockResolvedValue(1)
  mocks.balances.mockResolvedValue([
    {
      id: 'balance',
      lotId: 'lot',
      warehouseId: 'warehouse',
      version: 1,
      onHandQty: D(3),
      reservedQty: D(1),
      warehouse: { name: 'Main' },
      lot: {
        unitCost: D(12345),
        inventoryPart: { name: 'Part', partNumber: 'A', brand: { name: '---' } },
      },
    },
  ])
  const result = await listLedgerStock()
  expect(result.success).toBe(true)
  expect(JSON.stringify(result.data)).not.toMatch(/unitCost|12345|costAmount/)
  expect(result.data?.rows[0].available).toBe('2.000')
  expect(mocks.balances.mock.calls[0][0].where.organizationId).toBe('org')
})
it('blocks even an owner while the feature flag is disabled', async () => {
  vi.stubEnv('STOCK_LEDGER_ENABLED', 'false')
  mocks.member.mockResolvedValue({ organizationId: 'org', role: 'owner' })
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect((await getLedgerDocument('id')).success).toBe(false)
  consoleError.mockRestore()
  expect(mocks.document).not.toHaveBeenCalled()
})
