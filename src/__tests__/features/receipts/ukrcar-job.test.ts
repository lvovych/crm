// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorContext } from '@/features/integrations/Lib/types'

const m = vi.hoisted(() => ({
  login: vi.fn(),
  request: vi.fn(),
  parseList: vi.fn(),
  parseReceipt: vi.fn(),
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
vi.mock('@/integrations/ukrcar/client', () => ({
  UkrcarClient: class {
    login = m.login
    request = m.request
  },
}))
vi.mock('@/integrations/ukrcar/parser', () => ({
  listUrl: () => 'page1',
  parseList: m.parseList,
  parseReceipt: m.parseReceipt,
}))
import { connector } from '@/integrations/ukrcar/server'

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
const job = () => connector.jobs['supplier.receipts.import'](ctx, payload)

beforeEach(() => {
  vi.resetAllMocks()
  m.imported.mockResolvedValue([])
  m.request.mockImplementation(async (url) => url)
  m.existing.mockResolvedValue(null)
  m.create.mockResolvedValue({ id: 'new', created: true })
  m.parseReceipt.mockImplementation((_html, ref) => ({ ...ref, lines: [] }))
})

describe('UkrCar background job', () => {
  it('continues after a bad document, visits the next page and asks the queue to retry failures', async () => {
    m.parseList.mockImplementation((html) =>
      html === 'page1'
        ? { receipts: [{ number: 'bad', url: 'bad' }], next: 'page2' }
        : { receipts: [{ number: 'good', url: 'good' }], next: null }
    )
    m.parseReceipt.mockImplementation((_html, ref) => {
      if (ref.number === 'bad') throw new Error('Incomplete document')
      return { ...ref, lines: [] }
    })
    await expect(job()).rejects.toThrow('не імпортовано 1')
    expect(m.request).toHaveBeenCalledWith('page2')
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.saveState.mock.lastCall?.[0].receiptImport).toMatchObject({
      runId: payload.runId,
      created: 1,
      skipped: 0,
      processed: 2,
    })
  })
  it('resumes committed documents without double counting them as already existing', async () => {
    m.imported.mockResolvedValue([{ entityId: 'committed' }])
    m.parseList.mockReturnValue({
      receipts: [
        { number: 'old', url: 'old' },
        { number: 'new', url: 'new' },
      ],
      next: null,
    })
    m.existing.mockImplementation(async (query) =>
      query.where.organizationId_number.number === 'old'
        ? { id: 'committed', supplierId: 'supplier' }
        : null
    )
    await job()
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.saveState.mock.lastCall?.[0].receiptImport).toMatchObject({
      created: 2,
      skipped: 0,
      processed: 2,
    })
  })
  it('does not report success when authentication or pagination fails', async () => {
    m.login.mockRejectedValueOnce(new Error('Authentication failed'))
    await expect(job()).rejects.toThrow('Authentication failed')
    expect(m.parseList).not.toHaveBeenCalled()
    m.parseList.mockReturnValue({ receipts: [], next: 'page1' })
    await expect(job()).rejects.toThrow('ліміт')
  })
})
