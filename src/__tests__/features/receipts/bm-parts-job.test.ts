// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorContext } from '@/features/integrations/Lib/types'
const m = vi.hoisted(() => ({
  sales: vi.fn(),
  existing: vi.fn(),
  imported: vi.fn(),
  create: vi.fn(),
  log: vi.fn(),
  saveState: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    counterparty: { count: async () => 1 },
    integrationLink: { findMany: m.imported },
    supplierReceipt: { findUnique: m.existing },
    $transaction: async (fn: (tx: object) => unknown) => fn({}),
  },
}))
vi.mock('@/features/receipts/enabled', () => ({ receiptsEnabled: () => true }))
vi.mock('@/features/receipts/import-service', () => ({
  RECEIPT_IMPORT_JOB: 'supplier.receipts.import',
  importReceiptDraft: m.create,
  supplierOptions: vi.fn(),
}))
vi.mock('@/integrations/bm-parts/client', () => ({
  API_ORIGIN: 'https://api.bm.parts',
  BmPartsClient: class {
    sales = m.sales
  },
}))
import { connector } from '@/integrations/bm-parts/server'
const payload = {
  from: '2026-11-06',
  to: '2026-11-19',
  userId: 'user',
  runId: '30d6d7ad-949b-425b-9e4c-7bd9a37d30dd',
}
const ctx = {
  connection: {
    organizationId: 'org',
    id: 'connection',
    settings: { supplierId: 'supplier' },
    state: {},
  },
  credentials: {},
  http: { fetch: vi.fn() },
  log: m.log,
  saveState: m.saveState,
} as unknown as ConnectorContext
const raw = (n: number) => ({
  document_uuid: String(n).padStart(32, '0'),
  number: `ДГ${n}`,
  created_at: '2026-11-10T12:00:00Z',
  currency: { name: 'ГРН' },
  total: 10,
  products: [
    {
      quantity: 1,
      price: 10,
      total: 10,
      product: { article: 'A', name: 'Filter', brand: { name: 'Brand' } },
    },
  ],
})
const job = () => connector.jobs['supplier.receipts.import'](ctx, payload)
beforeEach(() => {
  vi.resetAllMocks()
  m.imported.mockResolvedValue([])
  m.existing.mockResolvedValue(null)
  m.create.mockImplementation(async (_tx, input) => ({ created: true, id: input.receipt.number }))
})
describe('BM background import', () => {
  it('visits the next page even after a short page and continues after one bad document', async () => {
    m.sales
      .mockResolvedValueOnce([{ ...raw(1), total: 11 }])
      .mockResolvedValueOnce([raw(2)])
      .mockResolvedValueOnce([])
    await expect(job()).rejects.toThrow('не імпортовано 1')
    expect(m.sales).toHaveBeenCalledTimes(3)
    expect(m.create).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        source: 'bm-parts',
        receipt: expect.objectContaining({ number: 'ДГ2' }),
      })
    )
    expect(m.saveState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        receiptImport: expect.objectContaining({ created: 1, processed: 2 }),
      })
    )
  })
  it('skips manual numbers and retains the committed count across retries', async () => {
    m.imported.mockResolvedValue([{ entityId: 'committed' }])
    m.existing
      .mockResolvedValueOnce({ id: 'committed', supplierId: 'supplier' })
      .mockResolvedValueOnce({ id: 'manual', supplierId: 'supplier' })
    m.sales.mockResolvedValueOnce([raw(1), raw(2)]).mockResolvedValueOnce([])
    await expect(job()).resolves.toEqual(
      expect.objectContaining({
        summary: expect.stringContaining('Створено чернеток: 1; вже існують: 1'),
      })
    )
    expect(m.create).not.toHaveBeenCalled()
  })
  it('fails instead of silently truncating when API repeats pages', async () => {
    m.sales.mockResolvedValue([raw(1)])
    await expect(job()).rejects.toThrow('повторює сторінки')
    expect(m.create).toHaveBeenCalledTimes(1)
  })
  it('reports a supplier conflict and never overwrites the existing document', async () => {
    m.existing.mockResolvedValue({ id: 'manual', supplierId: 'other' })
    m.sales.mockResolvedValueOnce([raw(1)]).mockResolvedValueOnce([])
    await expect(job()).rejects.toThrow('не імпортовано 1')
    expect(m.create).not.toHaveBeenCalled()
    expect(m.log).toHaveBeenCalledWith(
      'warn',
      expect.any(String),
      expect.objectContaining({ reason: expect.stringContaining('іншим постачальником') })
    )
  })
})
