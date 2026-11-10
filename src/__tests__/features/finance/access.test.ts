import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ membership: vi.fn(), findMany: vi.fn(), zone: vi.fn() }))
vi.mock('@/lib/cached-session', () => ({ getCachedMembership: mocks.membership }))
vi.mock('@/lib/db', () => ({ db: { moneyAccount: { findMany: mocks.findMany } } }))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: mocks.zone }))
import {
  accessibleAccounts,
  assertAccountAccess,
  assertFinancePermission,
  assertOperationDate,
  financeCapabilities,
} from '@/features/finance/access'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
const ctx = {
  organizationId: 'own',
  userId: 'user',
  role: 'member',
  isAdmin: false,
  isSuperAdmin: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.membership.mockResolvedValue({
    organizationId: 'own',
    roleId: 'role',
    customRole: { permissions: [] },
  })
  mocks.findMany.mockResolvedValue([])
  mocks.zone.mockResolvedValue('Europe/Kyiv')
})
describe('finance permissions', () => {
  it('does not infer posting rights from finance read', async () => {
    mocks.membership.mockResolvedValue({
      organizationId: 'own',
      roleId: 'role',
      customRole: { permissions: [{ action: A.READ, subject: S.FINANCE }] },
    })
    await expect(assertFinancePermission(ctx, A.UPDATE)).rejects.toThrow('прав')
    expect((await financeCapabilities(ctx)).post).toBe(false)
  })
  it('rejects a membership from another organization', async () => {
    mocks.membership.mockResolvedValue({
      organizationId: 'foreign',
      roleId: 'role',
      customRole: { permissions: [{ action: A.MANAGE, subject: S.FINANCE }] },
    })
    await expect(assertFinancePermission(ctx, A.UPDATE)).rejects.toThrow('прав')
  })
  it('allows the owner to manage accounts', async () => {
    await expect(
      assertFinancePermission({ ...ctx, isAdmin: true }, A.MANAGE)
    ).resolves.toBeUndefined()
  })
  it('scopes account reads by tenant and role', async () => {
    await accessibleAccounts(ctx)
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'own', access: { some: { roleId: 'role', canRead: true } } },
      })
    )
  })
  it('scopes writes to accounts that permit posting', async () => {
    await accessibleAccounts(ctx, true)
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'own', access: { some: { roleId: 'role', canPost: true } } },
      })
    )
  })
  it('rejects an inaccessible or archived account', async () => {
    await expect(assertAccountAccess(ctx, ['foreign'])).rejects.toThrow('доступу')
    mocks.findMany.mockResolvedValue([{ id: 'own-cash', isArchived: true }])
    await expect(assertAccountAccess(ctx, ['own-cash'])).rejects.toThrow('доступу')
  })
  it('accepts both permitted transfer accounts', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'cash', isArchived: false },
      { id: 'bank', isArchived: false },
    ])
    await expect(assertAccountAccess(ctx, ['cash', 'bank'])).resolves.toBeUndefined()
  })
  it('rejects future dates even for an administrator', async () => {
    await expect(assertOperationDate({ ...ctx, isAdmin: true }, '2099-01-01')).rejects.toThrow(
      'майбутню'
    )
  })
  it('requires separate backdate permission', async () => {
    await expect(assertOperationDate(ctx, '2020-01-01')).rejects.toThrow('прав')
    mocks.membership.mockResolvedValue({
      organizationId: 'own',
      roleId: 'role',
      customRole: { permissions: [{ action: A.CREATE, subject: S.FINANCE_BACKDATE }] },
    })
    await expect(assertOperationDate(ctx, '2020-01-01')).resolves.toBeUndefined()
  })
})

describe('account management is independent from money operations', () => {
  it.each([
    [A.UPDATE, S.FINANCE, false, true, false],
    [A.MANAGE, S.FINANCE_ACCOUNTS, true, false, false],
    [A.MANAGE, S.FINANCE, false, false, true],
    [A.READ, S.FINANCE, false, false, false],
  ])('separates %s on %s', async (action, subject, manageAccounts, post, manage) => {
    mocks.membership.mockResolvedValue({
      organizationId: 'own',
      roleId: 'role',
      customRole: { permissions: [{ action, subject }] },
    })
    expect(await financeCapabilities(ctx)).toMatchObject({ manageAccounts, post, manage })
    if (!manageAccounts)
      await expect(assertFinancePermission(ctx, A.MANAGE, S.FINANCE_ACCOUNTS)).rejects.toThrow()
    if (!post) await expect(assertFinancePermission(ctx, A.UPDATE)).rejects.toThrow()
  })
  it('does not let account ACL alone grant a global operation permission', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'cash', isArchived: false }])
    await expect(assertAccountAccess(ctx, ['cash'])).resolves.toBeUndefined()
    await expect(assertFinancePermission(ctx, A.UPDATE)).rejects.toThrow()
  })
  it('requires account access even when the role may post money', async () => {
    mocks.membership.mockResolvedValue({
      organizationId: 'own',
      roleId: 'role',
      customRole: { permissions: [{ action: A.UPDATE, subject: S.FINANCE }] },
    })
    await expect(assertFinancePermission(ctx, A.UPDATE)).resolves.toBeUndefined()
    await expect(assertAccountAccess(ctx, ['cash'])).rejects.toThrow()
  })
})
