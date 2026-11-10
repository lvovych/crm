// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest'
const m = vi.hoisted(() => ({ entity: vi.fn(), account: vi.fn(), find: vi.fn(), permission: true }))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        ownLegalEntity: { updateMany: m.entity },
        moneyAccount: { updateMany: m.account, findFirst: m.find },
      }),
  },
}))
vi.mock('@/features/finance/ledger', () => ({ lockFinance: vi.fn() }))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: unknown) => unknown, options: { requiredPermissions: unknown[] }) => {
    expect(options.requiredPermissions).toEqual([{ action: 'manage', subject: 'finance_accounts' }])
    if (!m.permission) return { success: false }
    try {
      return { success: true, data: await fn({ organizationId: 'org', userId: 'u' }) }
    } catch {
      return { success: false }
    }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { saveFinanceDirectory } from '@/features/finance/actions'
beforeEach(() => {
  vi.clearAllMocks()
  m.permission = true
  m.entity.mockResolvedValue({ count: 1 })
  m.account.mockResolvedValue({ count: 1 })
  m.find.mockResolvedValue({ kind: 'bank' })
})
it('updates tax ID as text without replacing entity or linked accounts', async () => {
  expect(
    (
      await saveFinanceDirectory({
        type: 'editEntity',
        id: 'e',
        name: 'Company',
        taxId: '1234567890',
      })
    ).success
  ).toBe(true)
  expect(m.entity).toHaveBeenCalledWith({
    where: { id: 'e', organizationId: 'org' },
    data: { name: 'Company', taxId: '1234567890' },
  })
  expect(m.account).not.toHaveBeenCalled()
})
it('preserves leading zeros and supports explicit clearing', async () => {
  await saveFinanceDirectory({
    type: 'editEntity',
    id: 'e',
    name: 'Company',
    taxId: '0012345678',
  })
  expect(m.entity.mock.calls[0][0].data.taxId).toBe('0012345678')
  await saveFinanceDirectory({
    type: 'editEntity',
    id: 'e',
    name: 'Company',
    taxId: '  ',
  })
  expect(m.entity.mock.calls[1][0].data.taxId).toBeNull()
})
it('normalizes pasted IBAN and changes only the bank name and IBAN', async () => {
  expect(
    (
      await saveFinanceDirectory({
        type: 'rename',
        kind: 'account',
        id: 'b',
        name: 'Bank',
        iban: 'ua21 322313 0000026007233566001',
      })
    ).success
  ).toBe(true)
  expect(m.account).toHaveBeenCalledWith({
    where: { id: 'b', organizationId: 'org' },
    data: { name: 'Bank', iban: 'UA213223130000026007233566001' },
  })
})
it('keeps legacy name-only updates from clearing details', async () => {
  await saveFinanceDirectory({ type: 'rename', kind: 'account', id: 'b', name: 'Bank' })
  expect(m.account.mock.calls[0][0].data).toEqual({ name: 'Bank' })
  await saveFinanceDirectory({ type: 'rename', kind: 'entity', id: 'e', name: 'Company' })
  expect(m.entity.mock.calls[0][0].data).toEqual({ name: 'Company' })
})
it('rejects cash IBAN and missing or foreign accounts', async () => {
  for (const account of [{ kind: 'cash' }, null]) {
    m.find.mockResolvedValue(account)
    expect(
      (
        await saveFinanceDirectory({
          type: 'rename',
          kind: 'account',
          id: 'b',
          name: 'Bank',
          iban: 'UA123',
        })
      ).success
    ).toBe(false)
  }
  expect(m.account).not.toHaveBeenCalled()
  expect(m.find).toHaveBeenCalledWith({ where: { id: 'b', organizationId: 'org' } })
})
it('rejects missing entities and excessive lengths', async () => {
  m.entity.mockResolvedValue({ count: 0 })
  expect(
    (
      await saveFinanceDirectory({
        type: 'editEntity',
        id: 'e',
        name: 'Company',
        taxId: '1234567890',
      })
    ).success
  ).toBe(false)
  vi.clearAllMocks()
  for (const payload of [
    { kind: 'entity', taxId: '1'.repeat(31) },
    { kind: 'account', iban: 'A'.repeat(35) },
  ])
    expect(
      (
        await saveFinanceDirectory({
          type: payload.kind === 'entity' ? 'editEntity' : 'rename',
          id: 'e',
          name: 'Company',
          ...payload,
        })
      ).success
    ).toBe(false)
  expect(m.entity).not.toHaveBeenCalled()
  expect(m.account).not.toHaveBeenCalled()
})
it('denies modifications without directory management rights', async () => {
  m.permission = false
  expect(
    (
      await saveFinanceDirectory({
        type: 'editEntity',
        id: 'e',
        name: 'Company',
        taxId: '1234567890',
      })
    ).success
  ).toBe(false)
  expect(m.entity).not.toHaveBeenCalled()
})
