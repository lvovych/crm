// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  org: '',
  admin: true,
  owner: true,
  permissions: [] as { action: string; subject: string }[],
  actor: 'finance-test-actor',
}))
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, key) => {
        const value = Reflect.get(state.db, key)
        return typeof value === 'function' ? value.bind(state.db) : value
      },
    }
  ),
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (
    fn: (ctx: unknown) => Promise<unknown>,
    options?: {
      requiredPermissions?: { action: string; subject: string }[]
    }
  ) => {
    try {
      if (
        !state.admin &&
        !options?.requiredPermissions?.every((required) =>
          state.permissions.some(
            (p) => p.action === required.action && p.subject === required.subject
          )
        )
      )
        throw new Error('Permission denied')
      return {
        success: true,
        data: await fn({
          organizationId: state.org,
          userId: state.actor,
          isAdmin: state.admin,
          isOrganizationOwner: state.owner,
          role: 'owner',
          isSuperAdmin: false,
        }),
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  },
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedMembership: vi.fn(async () => ({
    organizationId: state.org,
    roleId: 'configuration-role',
    customRole: { permissions: state.permissions },
  })),
}))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
vi.mock('@/lib/workshop-currency', () => ({
  workshopCurrencySettings: async () => ({ currencyCode: 'UAH' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { paySalaryDocument } from '@/features/payroll/salary-payments'
import { saveFinanceDirectory } from '@/features/finance/actions'
import { postMoney } from '@/features/finance/ledger'
import type { TxClient } from '@/lib/db'
import { zonedDayKey } from '@/lib/timezone'
const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('Cash overdraft opt-in on PostgreSQL', () => {
  let entity: string, cash: string, category: string
  const today = zonedDayKey(new Date(), 'Europe/Kyiv')
  beforeAll(() => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Dedicated local test database required')
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  })
  beforeEach(async () => {
    state.owner = true
    state.org = (
      await state.db.organization.create({ data: { name: 'Cash overdraft ' + randomUUID() } })
    ).id
    entity = (
      await state.db.ownLegalEntity.create({ data: { organizationId: state.org, name: 'Service' } })
    ).id
    cash = (
      await state.db.moneyAccount.create({
        data: { organizationId: state.org, legalEntityId: entity, name: 'Cash', kind: 'cash' },
      })
    ).id
    category = (
      await state.db.cashFlowCategory.create({
        data: { organizationId: state.org, direction: 'expense', name: 'Зарплати' },
      })
    ).id
    await state.db.financeSettings.create({
      data: { organizationId: state.org, activatedOn: new Date('2026-01-01') },
    })
  })
  afterAll(async () => {
    await state.db?.$disconnect()
  })
  const change = (allowNegative: boolean) =>
    saveFinanceDirectory({ type: 'rename', kind: 'account', id: cash, name: 'Cash', allowNegative })
  const expense = () =>
    state.db.$transaction((tx) =>
      postMoney(tx as unknown as TxClient, state.org, state.actor, {
        requestId: randomUUID(),
        kind: 'expense',
        date: today,
        amount: '10.25',
        sourceAccountId: cash,
        categoryId: category,
        note: 'Salary expense',
      })
    )
  it('defaults to prohibition, permits overdraft after opt-in, and blocks disabling until replenished', async () => {
    await expect(expense()).rejects.toThrow('Недостатньо коштів')
    expect((await change(true)).success).toBe(true)
    await expense()
    expect((await change(false)).success).toBe(false)
    expect(
      (await state.db.moneyAccount.findUniqueOrThrow({ where: { id: cash } })).allowNegative
    ).toBe(true)
    const incoming = await state.db.cashFlowCategory.create({
      data: { organizationId: state.org, direction: 'income', name: 'Поповнення' },
    })
    await state.db.$transaction((tx) =>
      postMoney(tx as unknown as TxClient, state.org, state.actor, {
        requestId: randomUUID(),
        kind: 'income',
        date: today,
        amount: '10.25',
        targetAccountId: cash,
        categoryId: incoming.id,
        note: 'Replenishment',
      })
    )
    expect((await change(false)).success).toBe(true)
    await expect(expense()).rejects.toThrow('Недостатньо коштів')
  })
  it('restricts cash opt-in and setting changes to the owner, including crafted requests', async () => {
    state.owner = false
    expect((await change(true)).success).toBe(false)
    expect(
      (
        await saveFinanceDirectory({
          type: 'account',
          name: 'New cash',
          kind: 'cash',
          legalEntityId: entity,
          allowNegative: true,
        })
      ).success
    ).toBe(false)
    expect(
      (
        await saveFinanceDirectory({
          type: 'account',
          name: 'Default cash',
          kind: 'cash',
          legalEntityId: entity,
        })
      ).success
    ).toBe(true)
    expect(
      (await saveFinanceDirectory({ type: 'rename', kind: 'account', id: cash, name: 'Renamed' }))
        .success
    ).toBe(true)
    state.owner = true
    expect(
      (
        await saveFinanceDirectory({
          type: 'account',
          name: 'Permitted cash',
          kind: 'cash',
          legalEntityId: entity,
          allowNegative: true,
        })
      ).success
    ).toBe(true)
    expect(
      (
        await saveFinanceDirectory({
          type: 'rename',
          kind: 'entity',
          id: entity,
          name: 'Bad',
          allowNegative: true,
        })
      ).success
    ).toBe(false)
    expect(
      (
        await saveFinanceDirectory({
          type: 'rename',
          kind: 'account',
          id: randomUUID(),
          name: 'Foreign',
          allowNegative: true,
        })
      ).success
    ).toBe(false)
  })
  it('allows a salary payout into negative cash only after owner opt-in', async () => {
    const employee = await state.db.technician.create({
      data: { organizationId: state.org, name: 'Mechanic' },
    })
    const slip = await state.db.paySlip.create({
      data: {
        technicianId: employee.id,
        start: new Date(today),
        end: new Date(today),
        status: 'completed',
        total: '25.00',
        actorId: state.actor,
        lines: { version: 2, lines: [], conditions: [], total: '25.00' },
      },
    })
    const input = {
      slipId: slip.id,
      requestId: randomUUID(),
      account: cash,
      amount: '25',
      date: today,
    }
    expect((await paySalaryDocument(input)).success).toBe(false)
    expect(await state.db.staffPayment.count({ where: { technicianId: employee.id } })).toBe(0)
    await change(true)
    expect((await paySalaryDocument(input)).success).toBe(true)
    expect(
      (
        await state.db.moneyEntry.aggregate({ where: { accountId: cash }, _sum: { amount: true } })
      )._sum.amount?.toFixed(2)
    ).toBe('-25.00')
    expect((await change(false)).success).toBe(false)
  })
  it('serializes disabling with an expense so no prohibited negative balance is committed', async () => {
    await change(true)
    await Promise.allSettled([change(false), expense()])
    const account = await state.db.moneyAccount.findUniqueOrThrow({ where: { id: cash } })
    const balance = await state.db.moneyEntry.aggregate({
      where: { accountId: cash },
      _sum: { amount: true },
    })
    expect(account.allowNegative || !balance._sum.amount?.lt(0)).toBe(true)
  })
})
