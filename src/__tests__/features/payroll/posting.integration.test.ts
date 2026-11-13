// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  org: '',
  admin: true,
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
          isOrganizationOwner: state.admin,
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { postSlip, previewSlip, finishSAL, removeAssignedRule, deleteCatalogRule } from '@/features/payroll/actions'
import { payEmployee } from '@/features/payroll/settlements'
import { fingerprint, postMoney } from '@/features/finance/ledger'
import { reverseMoneyDocument } from '@/features/finance/actions'
import type { TxClient } from '@/lib/db'
const url = process.env.FINANCE_TEST_DATABASE_URL
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [key, value] of Object.entries(fields)) f.set(key, value)
  return f
}
describe.skipIf(!url)('Payroll posting on PostgreSQL', () => {
  let account: string, category: string, employee: string
  const start = '2026-01-05',
    next = '2026-01-12'
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Dedicated local test database required')
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    state.org = (
      await state.db.organization.create({ data: { name: 'Payroll ' + randomUUID() } })
    ).id
    const entity = await state.db.ownLegalEntity.create({
      data: { organizationId: state.org, name: 'Payroll' },
    })
    account = (
      await state.db.moneyAccount.create({
        data: { organizationId: state.org, legalEntityId: entity.id, name: 'Cash', kind: 'cash' },
      })
    ).id
    category = (
      await state.db.cashFlowCategory.create({
        data: { organizationId: state.org, name: 'Payroll expense', direction: 'expense' },
      })
    ).id
    await state.db.financeSettings.create({
      data: { organizationId: state.org, activatedOn: new Date(start) },
    })
    await state.db.$transaction((tx) =>
      postMoney(
        tx as unknown as TxClient,
        state.org,
        state.actor,
        {
          requestId: randomUUID(),
          kind: 'opening',
          date: start,
          amount: '10000.00',
          targetAccountId: account,
          note: 'Opening',
        },
        { opening: true }
      )
    )
    employee = (
      await state.db.technician.create({ data: { organizationId: state.org, name: 'Combined' } })
    ).id
    await state.db.payPlan.create({
      data: {
        technicianId: employee,
        effective: new Date(start),
        frequency: 'weekly',
        monthly: 0,
        labor: 50,
        orderMargin: 20,
        partsSales: 0,
        partsMargin: 0,
        afterDiscount: false,
      },
    })
    for (const [date, labor, sale, cost] of [
      [start, 1050, 2070.7, 1000],
      [next, 800, 400, 200],
    ] as const) {
      await state.db.serviceRecord.create({
        data: {
          organizationId: state.org,
          title: 'Combo',
          subtotal: labor + sale,
          status: 'completed',
          payrollEarnedAt: new Date(date),
          payAssignment: { create: { ownerId: employee } },
          laborItems: { create: { description: 'Labor', total: labor, technicianId: employee } },
          partItems: { create: { name: 'Part', unitPrice: sale, total: sale, unitCost: cost } },
        },
      })
    }
  })
  afterAll(async () => {
    await state.db?.$disconnect()
  })
  async function slip(date: string) {
    const preview = await previewSlip(employee, date)
    expect(preview.success).toBe(true)
    return form({ employee, start: date, preview: fingerprint(preview.data!.lines) })
  }
  function payment(amount: string, requestId = randomUUID()) {
    return form({ employee, type: 'payment', requestId, date: start, amount, account, category })
  }
  it('keeps one expense across concurrent retries, two weeks, a stale preview and reversal', async () => {
    const draft = await slip(start)
    const changed = form({ employee, start, preview: 'stale' })
    await expect(postSlip(changed)).rejects.toThrow()
    expect(await state.db.paySlip.count({ where: { technicianId: employee } })).toBe(0)
    const results = await Promise.allSettled([postSlip(draft), postSlip(draft)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const requestId = randomUUID()
    await Promise.all([
      payEmployee(payment('1200', requestId)),
      payEmployee(payment('1200', requestId)),
    ])
    await expect(payEmployee(payment('1300', requestId))).rejects.toThrow()
    const pending = await slip(next)
    pending.set('draft', 'yes')
    await postSlip(pending)
    const saved = await state.db.paySlip.findFirstOrThrow({ where: { technicianId: employee, status: 'new' }, include: { allocations: true } })
    expect(saved.allocations).toHaveLength(0)
    await Promise.all([finishSAL(form({ slip: saved.id })), finishSAL(form({ slip: saved.id }))])
    expect((await state.db.paySlip.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('completed')
    const slips = await state.db.paySlip.findMany({
      where: { technicianId: employee },
      orderBy: { start: 'asc' },
      include: { allocations: true },
    })
    expect(
      slips.map((s) => [s.total.toFixed(2), s.allocations.map((a) => a.amount.toFixed(2))])
    ).toEqual([
      ['949.14', ['949.14']],
      ['600.00', ['250.86']],
    ])
    const pays = await state.db.staffPayment.findMany({
      where: { technicianId: employee },
      include: { document: { include: { entries: true } } },
    })
    expect(pays).toHaveLength(1)
    expect(pays[0].document.entries.map((e) => e.amount.toFixed(2))).toEqual(['-1200.00'])
    await payEmployee(payment('400'))
    const reversed = await reverseMoneyDocument({
      id: pays[0].documentId,
      requestId: randomUUID(),
      date: next,
      reason: 'Test reversal',
    })
    expect(reversed.success).toBe(true)

    const valid = await state.db.staffAllocation.findMany({
      where: { slip: { technicianId: employee }, payment: { document: { reversal: null } } },
    })
    expect(Object.fromEntries(valid.map((a) => [a.slipId, a.amount.toFixed(2)]))).toEqual({
      [slips[0].id]: '50.86',
      [slips[1].id]: '349.14',
    })
    const targeted = payment('200')
    targeted.set('targetWeek', next)
    await Promise.all([payEmployee(targeted), payEmployee(targeted)])
    const currentPayment = await state.db.staffPayment.findFirstOrThrow({
      where: { technicianId: employee, document: { requestId: String(targeted.get('requestId')) } },
      include: { allocations: true },
    })
    expect(currentPayment.allocations.map(a => [a.slipId, a.amount.toFixed(2)])).toEqual([
      [slips[1].id, '200.00'],
    ])
    const stale = payment('200')
    stale.set('targetWeek', next)
    await expect(payEmployee(stale)).rejects.toThrow('Залишок')
    expect(await state.db.financialDocument.count({
      where: { organizationId: state.org, requestId: String(stale.get('requestId')) },
    })).toBe(0)
  })
  it('refuses another organization’s employee and an unauthorized payout', async () => {
    const outsider = await state.db.organization.create({ data: { name: 'Other test' } })
    const foreign = await state.db.technician.create({
      data: { organizationId: outsider.id, name: 'Other' },
    })
    const f = payment('100')
    f.set('employee', foreign.id)
    await expect(payEmployee(f)).rejects.toThrow()
    expect((await previewSlip(foreign.id, start)).success).toBe(false)
    state.admin = false
    try {
      await expect(payEmployee(payment('100'))).rejects.toThrow()
      expect((await previewSlip(employee, start)).success).toBe(false)
    } finally {
      state.admin = true
    }
    expect(await state.db.staffPayment.count({ where: { technicianId: foreign.id } })).toBe(0)
  })
  it('removes a catalog option independently from an employee assignment and preserves saved SAL', async () => {
    const plan = await state.db.payPlan.findFirstOrThrow({ where: { technicianId: employee } })
    const rule = await state.db.salaryRule.create({ data: { organizationId: state.org, name: 'Labor test', basis: 'labor', rate: plan.labor } })
    await state.db.payPlan.update({ where: { id: plan.id }, data: { ruleIds: [rule.id] } })
    const slips = () => state.db.paySlip.findMany({ where: { technicianId: employee }, orderBy: { start: 'asc' }, select: { total: true, lines: true } })
    const saved = await slips()
    await deleteCatalogRule(form({ rule: rule.id }))
    expect(await state.db.salaryRule.findUnique({ where: { id: rule.id } })).toBeNull()
    expect((await state.db.payPlan.findUniqueOrThrow({ where: { id: plan.id } })).labor).toEqual(plan.labor)
    await removeAssignedRule(form({ plan: plan.id, basis: 'labor' }))
    const updated = await state.db.payPlan.findUniqueOrThrow({ where: { id: plan.id } })
    expect(updated.labor.toNumber()).toBe(0)
    expect(updated.orderMargin).toEqual(plan.orderMargin)
    expect(await slips()).toEqual(saved)
  })

})
