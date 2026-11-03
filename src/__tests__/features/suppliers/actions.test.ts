import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  ctx: { organizationId: 'org-a', userId: 'user-a', isAdmin: false },
  options: [] as any[],
  db: {
    counterparty: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierProfile: { upsert: vi.fn() },
    counterpartyContact: { deleteMany: vi.fn(), createMany: vi.fn() },
    counterpartyBankAccount: { deleteMany: vi.fn(), createMany: vi.fn() },
    supplierImportRun: { upsert: vi.fn() },
    auditLog: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: any, options: any = {}) => {
    mocks.options.push(options)
    try {
      return { success: true, data: await fn(mocks.ctx) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },
}))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
import {
  listSuppliers,
  getSupplier,
  saveSupplier,
  archiveSupplier,
} from '@/features/suppliers/Actions/supplierActions'
import { previewSupplierImport } from '@/features/suppliers/Actions/importActions'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.length = 0
  vi.stubEnv('SUPPLIER_DIRECTORY_ORGANIZATIONS', 'org-a')
  mocks.db.$transaction.mockImplementation(async (fn: any) => fn(mocks.db))
  mocks.db.counterparty.findMany.mockResolvedValue([])
  mocks.db.counterparty.count.mockResolvedValue(0)
  mocks.db.auditLog.findMany.mockResolvedValue([])
})
describe('Supplier actions', () => {
  it('gates rollout before database access', async () => {
    vi.stubEnv('SUPPLIER_DIRECTORY_ORGANIZATIONS', '')
    expect((await listSuppliers({})).success).toBe(false)
    expect(mocks.db.counterparty.findMany).not.toHaveBeenCalled()
  })
  it('scopes search and caps pagination on the server', async () => {
    await listSuppliers({ search: 'Acme', page: 2 })
    expect(mocks.db.counterparty.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'org-a' },
      skip: 25,
      take: 25,
    })
    expect(mocks.options[0].requiredPermissions).toEqual([{ action: 'read', subject: 'suppliers' }])
  })
  it('does not expose foreign supplier or history', async () => {
    mocks.db.counterparty.findFirst.mockResolvedValue(null)
    expect((await getSupplier('foreign')).success).toBe(false)
    expect(mocks.db.counterparty.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign',
      organizationId: 'org-a',
    })
    expect(mocks.db.auditLog.findMany).not.toHaveBeenCalled()
  })
  it('creates contact and profile within the same transaction and organization', async () => {
    mocks.db.counterparty.create.mockResolvedValue({ id: 'new' })
    const r = await saveSupplier({
      name: 'Acme',
      contacts: [{ phone: '+380501234567', isPrimary: true }],
    })
    expect(r.success).toBe(true)
    expect(mocks.db.$transaction).toHaveBeenCalledOnce()
    expect(mocks.db.counterparty.create.mock.calls[0][0].data).toMatchObject({
      organizationId: 'org-a',
      createdById: 'user-a',
    })
    expect(mocks.db.counterpartyContact.createMany.mock.calls[0][0].data[0]).toMatchObject({
      organizationId: 'org-a',
      counterpartyId: 'new',
    })
    expect(mocks.options[0].requiredPermissions).toEqual([
      { action: 'create', subject: 'suppliers' },
    ])
  })
  it('optimistic conflict stops child replacement', async () => {
    mocks.db.counterparty.updateMany.mockResolvedValue({ count: 0 })
    const r = await saveSupplier({ name: 'Acme' }, 'foreign', '2026-11-03T00:00:00Z')
    expect(r.success).toBe(false)
    expect(mocks.db.counterpartyContact.deleteMany).not.toHaveBeenCalled()
    expect(mocks.options[0].requiredPermissions).toEqual([
      { action: 'update', subject: 'suppliers' },
    ])
  })
  it('archives only within organization with a separate permission', async () => {
    mocks.db.counterparty.updateMany.mockResolvedValue({ count: 1 })
    await archiveSupplier('s1', true)
    expect(mocks.db.counterparty.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 's1', organizationId: 'org-a' },
      data: { isArchived: true },
    })
    expect(mocks.options[0].requiredPermissions).toEqual([
      { action: 'delete', subject: 'suppliers' },
    ])
  })
  it('preview only writes staging; never creates counterparties', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T15:00:00Z'))
    mocks.db.supplierImportRun.upsert.mockResolvedValue({ id: 'run' })
    const r = await previewSupplierImport(
      JSON.stringify({
        version: 1,
        source: 'carbook',
        sourceAccountId: 'source-shop',
        periodStart: '2023-11-02T22:00:00Z',
        snapshotAt: '2026-11-03T12:00:00Z',
        coverage: { suppliers: true, goods: true, services: true, returns: true, payments: true },
        suppliers: [{ externalId: 's1', data: { name: 'Acme' } }],
        movements: [
          {
            externalId: 'doc',
            supplierId: 's1',
            kind: 'payment',
            date: '2024-01-01T00:00:00Z',
            status: 'posted',
            amount: 100,
          },
        ],
      })
    )
    expect(r.success).toBe(true)
    expect(mocks.db.counterparty.create).not.toHaveBeenCalled()
    expect(mocks.db.supplierImportRun.upsert).toHaveBeenCalledOnce()
    expect(mocks.options[0].requiredPermissions).toContainEqual({
      action: 'manage',
      subject: 'suppliers',
    })
    vi.useRealTimers()
  })
})
