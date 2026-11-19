// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  connections: vi.fn(),
  queue: vi.fn(),
  supplier: vi.fn(),
  latest: vi.fn(),
  features: vi.fn(),
  enabled: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    integrationConnection: { findMany: m.connections },
    counterparty: { count: m.supplier },
    integrationJob: { findFirst: m.latest },
  },
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: object) => unknown) => ({
    data: await fn({ organizationId: 'org', userId: 'user' }),
  }),
}))
vi.mock('@/lib/demo', () => ({ demoGuard: vi.fn() }))
vi.mock('@/lib/features', () => ({ getFeatures: m.features }))
vi.mock('@/features/receipts/enabled', () => ({ receiptsEnabled: m.enabled }))
vi.mock('@/features/receipts/import-service', () => ({
  RECEIPT_IMPORT_JOB: 'supplier.receipts.import',
  queueReceiptImport: m.queue,
}))
vi.mock('@/integrations/registry', () => ({
  listManifests: () => [
    { id: 'ukrcar', name: 'UkrCar', capabilities: ['supplier.receipts'] },
    { id: 'bm-parts', name: 'BM Parts', capabilities: ['supplier.receipts'] },
    { id: 'smtp', capabilities: ['email'] },
  ],
}))
import { startReceiptImport, receiptImportStatus } from '@/features/receipts/import-actions'
const connections = () =>
  ['ukrcar', 'bm-parts'].map((id) => ({
    id,
    connectorId: id,
    settings: { supplierId: 'supplier' },
    state: {},
  }))
beforeEach(() => {
  vi.resetAllMocks()
  m.enabled.mockReturnValue(true)
  m.features.mockResolvedValue({ integrations: true })
  m.connections.mockResolvedValue(connections())
  m.supplier.mockResolvedValue(1)
  m.queue.mockImplementation(async (id) => id + '-job')
  m.latest.mockResolvedValue(null)
})
it('queues every configured supplier with one fixed period and org/user scope', async () => {
  const result = await startReceiptImport()
  expect(result.data?.results).toHaveLength(2)
  expect(m.queue).toHaveBeenCalledWith('ukrcar', 'org', 'user', expect.any(Object))
  expect(m.queue.mock.calls[0][3]).toEqual(m.queue.mock.calls[1][3])
  expect(m.connections).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        organizationId: 'org',
        connectorId: { in: ['ukrcar', 'bm-parts'] },
        status: { in: ['active', 'error'] },
      },
    })
  )
})
it('keeps one supplier queued when another fails', async () => {
  m.queue.mockImplementation(async (id) => {
    if (id === 'ukrcar') throw new Error('private failure')
    return 'bm-job'
  })
  const result = await startReceiptImport()
  expect(result.data?.results[0].error).not.toContain('private failure')
  expect(result.data?.results[1].jobId).toBe('bm-job')
})
it('never queues an archived or missing supplier', async () => {
  m.supplier.mockResolvedValue(0)
  await startReceiptImport()
  expect(m.queue).not.toHaveBeenCalled()
})
it('returns separate status without settings, credentials or stale progress', async () => {
  m.connections.mockResolvedValue([
    { ...connections()[1], state: { receiptImport: { runId: 'old', created: 10 } } },
  ])
  m.latest.mockResolvedValue({
    id: 'job',
    payload: { runId: 'new' },
    status: 'queued',
    attempts: 0,
    error: null,
  })
  const result = await receiptImportStatus()
  expect(result.data?.suppliers[0]).toEqual({
    connectorId: 'bm-parts',
    name: 'BM Parts',
    configured: true,
    job: { id: 'job', status: 'queued', attempts: 0, error: null },
    progress: null,
  })
})
it('enforces module enablement before querying or queuing', async () => {
  m.enabled.mockReturnValue(false)
  await expect(startReceiptImport()).rejects.toThrow('вимкнено')
  expect(m.queue).not.toHaveBeenCalled()
})
