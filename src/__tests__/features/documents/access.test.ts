import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  ctx: { organizationId: 'org', userId: 'user', isAdmin: false, isOrganizationOwner: false },
  permissions: [] as { action: string; subject: string }[],
  memberOrg: 'org',
  read: vi.fn(),
  detail: vi.fn(),
  accounts: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: Function) => ({ success: true, data: await fn(f.ctx) }),
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedMembership: async () => ({
    organizationId: f.memberOrg,
    customRole: { permissions: f.permissions },
  }),
}))
vi.mock('@/features/finance/access', () => ({ accessibleAccounts: f.accounts }))
vi.mock('@/features/receipts/enabled', () => ({ receiptsEnabled: () => true }))
vi.mock('@/features/settlements/ledger', () => ({ settlementsEnabled: () => true }))
vi.mock('@/features/documents/queries', () => ({ readJournal: f.read, readDocument: f.detail }))
import { documentJournal, documentDetail } from '@/features/documents/actions'
beforeEach(() => {
  vi.clearAllMocks()
  f.ctx.isAdmin = false
  f.ctx.isOrganizationOwner = false
  f.memberOrg = 'org'
  f.permissions = []
  f.read.mockResolvedValue({ rows: [], total: 0 })
  f.accounts.mockResolvedValue([{ id: 'allowed' }])
})
describe('document access', () => {
  it('does not grant payroll to admin or a custom role carrying payroll permission', async () => {
    f.permissions = [
      { subject: 'finance', action: 'read' },
      { subject: 'payroll', action: 'manage' },
    ]
    const result = await documentJournal({})
    expect(result.data?.types).not.toContain('salary')
    expect(f.read.mock.calls[0][1]).toMatchObject({
      finance: true,
      payroll: false,
      accounts: ['allowed'],
      receipts: false,
    })
    f.ctx.isAdmin = true
    await documentJournal({})
    expect(f.read.mock.calls[1][1].payroll).toBe(false)
  })
  it('permits salary only to the organization owner', async () => {
    f.ctx.isAdmin = true
    f.ctx.isOrganizationOwner = true
    expect((await documentJournal({})).data?.types).toContain('salary')
  })
  it('does not reuse another organizations permissions', async () => {
    f.memberOrg = 'other'
    f.permissions = [{ subject: 'finance', action: 'read' }]
    await expect(documentJournal({})).rejects.toThrow('Немає доступу')
    expect(f.accounts).not.toHaveBeenCalled()
    expect(f.read).not.toHaveBeenCalled()
  })
  it('rejects invalid document types before querying and scopes direct URLs', async () => {
    await documentDetail('unknown', 'id')
    expect(f.detail).not.toHaveBeenCalled()
    await documentDetail('salary', 'secret')
    expect(f.detail.mock.calls[0][1].payroll).toBe(false)
  })
})
