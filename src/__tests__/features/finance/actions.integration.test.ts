// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  org: '',
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
  withAuth: async (fn: (ctx: unknown) => Promise<unknown>) => {
    try {
      return {
        success: true,
        data: await fn({
          organizationId: state.org,
          userId: state.actor,
          isAdmin: true,
          role: 'owner',
          isSuperAdmin: false,
        }),
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  },
}))
vi.mock('@/lib/cached-session', () => ({ getCachedMembership: vi.fn() }))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
vi.mock('@/lib/workshop-currency', () => ({
  workshopCurrencySettings: async () => ({ currencyCode: 'UAH' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { postMoney } from '@/features/finance/ledger'
import {
  prepareCashOpening,
  saveFinanceDraft,
  updateFinanceDraft,
  postSavedFinanceDraft,
  financeReport,
  activateCashOpening,
  refundMoneyDocument,
  reverseMoneyDocument,
  assignUnlinkedPayment,
} from '@/features/finance/actions'
import { zonedDayKey } from '@/lib/timezone'
import type { TxClient } from '@/lib/db'
const url = process.env.FINANCE_TEST_DATABASE_URL
;(url ? describe : describe.skip)('finance action transactions', () => {
  let cash: string, paymentDocument: string, record: string
  const today = zonedDayKey(new Date(), 'Europe/Kyiv')
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw Error('Only local test database')
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    state.org = (await state.db.organization.create({ data: { name: 'Finance action test' } })).id
    const entity = await state.db.ownLegalEntity.create({
      data: { organizationId: state.org, name: 'Test' },
    })
    cash = (
      await state.db.moneyAccount.create({
        data: { organizationId: state.org, legalEntityId: entity.id, name: 'Cash', kind: 'cash' },
      })
    ).id
  })
  afterAll(async () => {
    await state.db?.$disconnect()
  })
  it('preparing balances does not activate or create movements', async () => {
    const result = await prepareCashOpening({
      date: today,
      balances: [{ accountId: cash, amount: '100.00' }],
    })
    expect(result.success).toBe(true)
    expect(await state.db.moneyEntry.count({ where: { organizationId: state.org } })).toBe(0)
    expect(
      await state.db.financeSettings.findUnique({ where: { organizationId: state.org } })
    ).toBeNull()
    const previous = process.env.FINANCE_ACTIVATION_ALLOWED
    delete process.env.FINANCE_ACTIVATION_ALLOWED
    try {
      const blocked = await activateCashOpening(result.data!.id)
      expect(blocked.success).toBe(false)
      expect(blocked.error).toContain('погодження')
    } finally {
      if (previous !== undefined) process.env.FINANCE_ACTIVATION_ALLOWED = previous
    }
  })
  it('rejects a cutover with missing or duplicated accounts', async () => {
    expect(
      (
        await prepareCashOpening({
          date: today,
          balances: [
            { accountId: cash, amount: '1' },
            { accountId: cash, amount: '1' },
          ],
        })
      ).success
    ).toBe(false)
    expect(
      (await prepareCashOpening({ date: today, balances: [{ accountId: 'foreign', amount: '1' }] }))
        .success
    ).toBe(false)
  })
  it('links an external payment idempotently without duplicating the work order payment', async () => {
    await state.db.financeSettings.create({
      data: { organizationId: state.org, activatedOn: new Date(today), activatedAt: new Date() },
    })
    record = (
      await state.db.serviceRecord.create({
        data: { organizationId: state.org, title: 'Refund test', totalAmount: 200 },
      })
    ).id
    const p = await state.db.payment.create({
      data: {
        serviceRecordId: record,
        amount: 100.01,
        method: 'card',
        provider: 'test',
        externalId: randomUUID(),
      },
    })
    const input = { paymentId: p.id, accountId: cash, requestId: randomUUID() }
    expect((await assignUnlinkedPayment(input)).success).toBe(true)
    expect((await assignUnlinkedPayment(input)).success).toBe(true)
    expect(await state.db.payment.count({ where: { serviceRecordId: record } })).toBe(1)
    const d = await state.db.financialDocument.findUniqueOrThrow({ where: { paymentId: p.id } })
    paymentDocument = d.id
    expect(d.amount.toFixed(2)).toBe('100.01')
  })
  it('partial refund updates both cash and work order once, then rejects over-refund', async () => {
    const input = {
      id: paymentDocument,
      requestId: randomUUID(),
      date: today,
      amount: '30.01',
      reason: 'Partial refund',
    }
    const result = await refundMoneyDocument(input)
    expect(result).toMatchObject({ success: true })
    expect((await refundMoneyDocument(input)).success).toBe(true)
    const payments = await state.db.payment.findMany({ where: { serviceRecordId: record } })
    expect(payments).toHaveLength(2)
    expect(payments.reduce((s, p) => s + Math.round(Number(p.amountExact) * 100), 0)).toBe(7000)
    const cashTotal = await state.db.moneyEntry.aggregate({
      where: { organizationId: state.org, accountId: cash },
      _sum: { amount: true },
    })
    expect(cashTotal._sum.amount?.toFixed(2)).toBe('70.00')
    expect(
      (await refundMoneyDocument({ ...input, requestId: randomUUID(), amount: '70.01' })).success
    ).toBe(false)
    expect(
      (
        await reverseMoneyDocument({
          id: paymentDocument,
          requestId: randomUUID(),
          date: today,
          reason: 'Cannot reverse refunded payment',
        })
      ).success
    ).toBe(false)
  })
  it('reversal of a separate payment appends a protected compensating payment', async () => {
    const d = await state.db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { serviceRecordId: record, amount: 20, amountExact: '20.00', method: 'cash' },
      })
      return postMoney(tx as unknown as TxClient, state.org, state.actor, {
        requestId: randomUUID(),
        kind: 'customer_payment',
        date: today,
        amount: '20.00',
        targetAccountId: cash,
        paymentId: p.id,
        note: 'Reverse me',
      })
    })
    const input = { id: d.id, requestId: randomUUID(), date: today, reason: 'Correction' }
    expect((await reverseMoneyDocument(input)).success).toBe(true)
    expect((await reverseMoneyDocument(input)).success).toBe(true)
    const reversed = await state.db.financialDocument.findUniqueOrThrow({
      where: { reversalOfId: d.id },
    })
    expect(reversed.paymentId).toBeTruthy()
    await expect(state.db.payment.delete({ where: { id: reversed.paymentId! } })).rejects.toThrow(
      'immutable'
    )
  })
  it('edits a draft atomically, keeps its identity, and forbids editing posted or foreign documents', async () => {
    const category = await state.db.cashFlowCategory.create({
      data: { organizationId: state.org, name: 'Draft income', direction: 'income' },
    })
    const requestId = randomUUID()
    const payload = {
      requestId,
      kind: 'income',
      date: today,
      amount: '1.00',
      targetAccountId: cash,
      categoryId: category.id,
      note: 'Draft edit test',
    }
    expect((await saveFinanceDraft(payload)).success).toBe(true)
    const draft = await state.db.financialDocument.findUniqueOrThrow({
      where: { organizationId_requestId: { organizationId: state.org, requestId } },
    })
    const before = await state.db.moneyEntry.count({ where: { organizationId: state.org } })
    expect(
      (await updateFinanceDraft(draft.id, { ...payload, requestId: randomUUID(), amount: '1,01' }))
        .success
    ).toBe(true)
    const edited = await state.db.financialDocument.findUniqueOrThrow({ where: { id: draft.id } })
    expect(edited.amount.toFixed(2)).toBe('1.01')
    expect(edited.requestId).toBe(requestId)
    expect(await state.db.moneyEntry.count({ where: { organizationId: state.org } })).toBe(before)
    const org = state.org
    try {
      state.org = 'foreign-org'
      expect((await updateFinanceDraft(draft.id, payload)).success).toBe(false)
    } finally {
      state.org = org
    }
    expect((await postSavedFinanceDraft(draft.id)).success).toBe(true)
    expect((await updateFinanceDraft(draft.id, { ...payload, amount: '99' })).success).toBe(false)
    expect(
      (
        await state.db.financialDocument.findUniqueOrThrow({ where: { id: draft.id } })
      ).amount.toFixed(2)
    ).toBe('1.01')
  })
  it('reports persisted account permissions to administrators', async () => {
    const role = await state.db.role.create({
      data: { name: 'Finance UX role', organizationId: state.org },
    })
    await state.db.moneyAccountAccess.create({
      data: {
        organizationId: state.org,
        accountId: cash,
        roleId: role.id,
        canRead: true,
        canPost: false,
      },
    })
    const report = await financeReport(today)
    expect(report.success).toBe(true)
    expect(report.data?.accountAccess).toContainEqual({
      accountId: cash,
      roleId: role.id,
      canRead: true,
      canPost: false,
    })
  })
  it('identifies clients and suppliers by identity including refunds, not free-text names', async () => {
    const user = await state.db.user.create({
      data: { id: randomUUID(), name: 'Party test', email: `${randomUUID()}@example.test` },
    })
    const customer = await state.db.customer.create({
      data: { userId: user.id, organizationId: state.org, name: 'Same name' },
    })
    await state.db.serviceRecord.update({
      where: { id: record },
      data: { customerId: customer.id },
    })
    const supplier = await state.db.counterparty.create({
      data: { organizationId: state.org, name: 'Same name', createdById: state.actor },
    })
    const payment = await state.db.supplierEntry.create({
      data: {
        organizationId: state.org,
        supplierId: supplier.id,
        kind: 'payment',
        amount: '1.00',
        date: new Date(today),
        createdById: state.actor,
      },
    })
    await state.db.$transaction((tx) =>
      postMoney(tx as TxClient, state.org, state.actor, {
        requestId: randomUUID(),
        kind: 'supplier_payment',
        date: today,
        amount: '1.00',
        sourceAccountId: cash,
        supplierEntryId: payment.id,
        note: 'Supplier identity',
      })
    )
    const report = await financeReport(today)
    expect(report.success).toBe(true)
    expect(report.data?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: paymentDocument,
          counterpartyType: 'customer',
          counterpartyId: customer.id,
          counterparty: 'Same name',
        }),
        expect.objectContaining({
          kind: 'refund',
          counterpartyType: 'customer',
          counterpartyId: customer.id,
        }),
        expect.objectContaining({
          kind: 'supplier_payment',
          counterpartyType: 'supplier',
          counterpartyId: supplier.id,
          counterparty: 'Same name',
        }),
      ])
    )
  })
})
