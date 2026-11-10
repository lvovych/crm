// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
const m = vi.hoisted(() => ({
  member: vi.fn(),
  records: vi.fn(),
  suppliers: vi.fn(),
  contacts: vi.fn(),
  enabled: vi.fn(),
  admin: false,
}))
vi.mock('@/lib/db', () => ({
  db: { serviceRecord: { findMany: m.records }, counterparty: { findMany: m.contacts } },
}))
vi.mock('@/lib/cached-session', () => ({ getCachedMembership: m.member }))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
vi.mock('@/features/settlements/ledger', () => ({ settlementsEnabled: m.enabled }))
vi.mock('@/features/settlements/actions', () => ({ settlementReport: m.suppliers }))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: unknown) => Promise<unknown>) => {
    try {
      return {
        success: true,
        data: await fn({ organizationId: 'org', userId: 'u', isAdmin: m.admin }),
      }
    } catch {
      return { success: false }
    }
  },
}))
import { mutualSettlementsReport } from '@/features/mutual-settlements/actions'
beforeEach(() => {
  vi.resetAllMocks()
  m.admin = false
  m.enabled.mockReturnValue(true)
  m.records.mockResolvedValue([])
  m.contacts.mockResolvedValue([])
  m.suppliers.mockResolvedValue({ success: true, data: [] })
  m.member.mockResolvedValue({ organizationId: 'org', customRole: { permissions: [] } })
})
function rights(...subjects: string[]) {
  m.member.mockResolvedValue({
    organizationId: 'org',
    customRole: { permissions: subjects.map((subject) => ({ action: 'read', subject })) },
  })
}
describe('overview authorization and source isolation', () => {
  it('denies no-rights roles before querying financial records', async () => {
    expect((await mutualSettlementsReport()).success).toBe(false)
    expect(m.records).not.toHaveBeenCalled()
    expect(m.suppliers).not.toHaveBeenCalled()
  })
  it('does not infer debt access from cash configuration', async () => {
    rights('finance_accounts')
    expect((await mutualSettlementsReport()).success).toBe(false)
  })
  it('scopes client-only access and never fetches supplier data', async () => {
    rights('billing')
    const r = await mutualSettlementsReport()
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ customersAllowed: true, suppliersAllowed: false })
    expect(m.records).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org' } })
    )
    expect(m.records.mock.calls[0][0].select).not.toHaveProperty('issuedData')
    expect(m.suppliers).not.toHaveBeenCalled()
  })
  it('supplier-only access never fetches customer records', async () => {
    rights('supplier_settlements')
    expect((await mutualSettlementsReport()).data).toMatchObject({
      customersAllowed: false,
      suppliersAllowed: true,
    })
    expect(m.records).not.toHaveBeenCalled()
  })
  it('keeps supplier feature gating', async () => {
    rights('supplier_settlements')
    m.enabled.mockReturnValue(false)
    expect((await mutualSettlementsReport()).success).toBe(false)
  })
  it('does not trust membership from another tenant', async () => {
    m.member.mockResolvedValue({
      organizationId: 'other',
      customRole: { permissions: [{ action: 'read', subject: 'billing' }] },
    })
    expect((await mutualSettlementsReport()).success).toBe(false)
  })
  it('does not fabricate historical customer figures', async () => {
    rights('billing', 'supplier_settlements')
    const r = await mutualSettlementsReport('2020-01-01')
    expect(r.data).toMatchObject({ customersHistoricalUnavailable: true })
    expect(m.records).not.toHaveBeenCalled()
    expect(m.suppliers).toHaveBeenCalledWith('2020-01-01')
  })
  it.each(['2099-01-01', '2026-02-30', 'bad'])('rejects invalid report date %s', async (date) => {
    rights('billing')
    expect((await mutualSettlementsReport(date)).success).toBe(false)
    expect(m.records).not.toHaveBeenCalled()
  })
  it('reports unavailable supplier data as an error rather than a zero debt', async () => {
    rights('supplier_settlements')
    m.suppliers.mockResolvedValue({ success: false })
    expect((await mutualSettlementsReport()).data?.supplierError).toBeTruthy()
  })
  it('supports owner read access without assigned custom permissions', async () => {
    m.admin = true
    expect((await mutualSettlementsReport()).success).toBe(true)
    expect(m.member).not.toHaveBeenCalled()
  })
})
it('preserves supplier debt and advances separately and excludes unverified receipts', async () => {
  rights('supplier_settlements')
  m.suppliers.mockResolvedValue({
    success: true,
    data: [
      {
        id: 's',
        name: 'Supplier',
        isArchived: false,
        debt: '500.01',
        advance: '100.00',
        overdue: '500.01',
        rows: [
          {
            id: 'entry',
            kind: 'receipt',
            active: true,
            reference: 'R-1',
            date: '2020-01-01',
            due: '2020-01-02',
            amount: '500.01',
            open: '500.01',
          },
        ],
        unknown: [{ id: 'old', number: 'OLD', total: '9000.00' }],
      },
    ],
  })
  m.contacts.mockResolvedValue([{ id: 's', contacts: [{ phone: '+380671234567' }] }])
  const result = await mutualSettlementsReport()
  expect(result.data?.parties[0]).toMatchObject({
    debt: '500.01',
    advance: '100.00',
    phone: '+380671234567',
  })
  expect(result.data?.parties[0].documents[1]).toMatchObject({
    amount: '9000.00',
    debt: '0.00',
    advance: '0.00',
    reason: expect.any(String),
  })
  expect(m.contacts).toHaveBeenCalledWith(
    expect.objectContaining({ where: { organizationId: 'org', id: { in: ['s'] } } })
  )
})
it('does not leak an unrelated tenant customer through a linked vehicle', async () => {
  rights('billing')
  m.records.mockResolvedValue([
    {
      id: 'r',
      title: 'Order',
      invoiceNumber: null,
      status: 'completed',
      totalAmount: 100,
      cost: 100,
      manuallyPaid: false,
      invoiceDueDate: null,
      invoiceDate: null,
      serviceDate: new Date('2020-01-01'),
      vehicleId: 'v',
      issuedData: null,
      customer: null,
      vehicle: {
        customer: {
          id: 'foreign',
          name: 'Private customer',
          phone: 'secret',
          organizationId: 'other',
        },
      },
      payments: [],
      _count: { partItems: 1, laborItems: 0 },
    },
  ])
  const result = await mutualSettlementsReport()
  expect(JSON.stringify(result)).not.toContain('Private customer')
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(result.data?.parties[0]).toMatchObject({ id: 'unassigned', debt: '0.00' })
})
