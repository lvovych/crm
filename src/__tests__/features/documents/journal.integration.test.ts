// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readJournal, readDocument, journalFilter } from '@/features/documents/queries'
import type { DocumentScope } from '@/features/documents/types'

const url = process.env.FINANCE_TEST_DATABASE_URL
const date = new Date('2026-11-18T00:00:00Z')
describe('journal filters', () => {
  it('rejects invalid dates, backwards periods and invalid pages', () => {
    for (const value of [
      { from: '2026-02-30' },
      { from: '2026-11-19', to: '2026-11-18' },
      { page: 0 },
      { page: 1.5 },
      { q: 'a'.repeat(121) },
    ])
      expect(journalFilter.safeParse(value).success).toBe(false)
  })
})
describe.skipIf(!url)('document journal on PostgreSQL', () => {
  let db: PrismaClient
  afterAll(async () => db?.$disconnect())
  async function setup() {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Local test DB required')
    db ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    const org = await db.organization.create({ data: { name: 'Journal test' } })
    const supplier = await db.counterparty.create({
      data: { organizationId: org.id, name: 'Supplier 100%_', createdById: 'test' },
    })
    const entity = await db.ownLegalEntity.create({
      data: { organizationId: org.id, name: 'Workshop' },
    })
    const account = await db.moneyAccount.create({
      data: {
        organizationId: org.id,
        legalEntityId: entity.id,
        name: 'Visible account',
        kind: 'bank',
      },
    })
    const hidden = await db.moneyAccount.create({
      data: {
        organizationId: org.id,
        legalEntityId: entity.id,
        name: 'Hidden account',
        kind: 'cash',
      },
    })
    const receipt = await db.supplierReceipt.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        number: 'J-001',
        documentDate: date,
        receivedDate: date,
        status: 'posted',
        createdById: 'test',
        lines: {
          create: {
            position: 0,
            kind: 'part',
            name: 'Part',
            quantity: '2',
            unit: 'шт',
            unitPrice: '100',
            amount: '200',
          },
        },
        settlement: {
          create: {
            organizationId: org.id,
            supplierId: supplier.id,
            kind: 'receipt',
            amount: '200',
            date,
            createdById: 'test',
          },
        },
      },
      include: { lines: true, settlement: true },
    })
    const order = await db.serviceRecord.create({
      data: {
        organizationId: org.id,
        title: 'Order',
        invoiceNumber: 'ORDER-001',
        totalAmount: 500,
        serviceDate: date,
      },
    })
    await db.receiptTransfer.create({
      data: {
        lineId: receipt.lines[0].id,
        requestId: randomUUID(),
        requestHash: 'test',
        serviceRecordId: order.id,
        serviceRecordLabel: 'ORDER-001',
        servicePartId: 'snapshot-part',
        quantity: '1',
        unitPrice: '100',
        createdById: 'test',
      },
    })
    const payment = await db.payment.create({
      data: { serviceRecordId: order.id, amount: 100, amountExact: '100', date },
    })
    const financial = await db.financialDocument.create({
      data: {
        organizationId: org.id,
        requestId: randomUUID(),
        fingerprint: 'test',
        kind: 'customer_payment',
        status: 'posted',
        date,
        amount: '100',
        targetAccountId: account.id,
        paymentId: payment.id,
        note: 'Payment',
        createdById: 'test',
      },
    })
    const credit = await db.supplierEntry.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        kind: 'payment',
        amount: '50',
        date,
        createdById: 'test',
      },
    })
    await db.supplierAllocation.create({
      data: {
        creditId: credit.id,
        debitId: receipt.settlement!.id,
        amount: '50',
        date,
        createdById: 'test',
      },
    })
    const scope: DocumentScope = {
      organizationId: org.id,
      receipts: true,
      orders: true,
      finance: true,
      settlements: true,
      payroll: false,
      accounts: [account.id],
    }
    return { org, supplier, receipt, order, payment, financial, credit, scope, account, hidden }
  }
  it('lists exact amounts once, searches literal wildcard characters and validates dates', async () => {
    const f = await setup(),
      result = await readJournal(db, f.scope, {})
    expect(result.total).toBe(4)
    expect(result.rows.some((r) => r.type === 'payment')).toBe(false)
    expect(result.rows.find((r) => r.id === f.receipt.id)?.amount).toBe('200.00')
    expect((await readJournal(db, f.scope, { q: '100%_' })).total).toBe(2)
    expect((await readJournal(db, f.scope, { q: "' OR 1=1 --" })).total).toBe(0)
    expect((await readJournal(db, f.scope, { from: '2026-11-19' })).total).toBe(0)
    expect((await readJournal(db, f.scope, { to: '2026-11-17' })).total).toBe(0)
    expect((await readJournal(db, f.scope, { type: 'receipt' })).total).toBe(1)
  })
  it('uses real transfers and allocations, never common supplier alone; blocks tenant and hidden bridges', async () => {
    const f = await setup()
    const unrelated = await db.supplierEntry.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        kind: 'opening_credit',
        amount: '99',
        date,
        createdById: 'test',
      },
    })
    const graph = await readDocument(db, f.scope, 'receipt:' + f.receipt.id)
    expect(graph?.related.map((r) => r.id)).toEqual(
      expect.arrayContaining([f.order.id, f.financial.id, f.credit.id])
    )
    expect(graph?.related.some((r) => r.id === unrelated.id)).toBe(false)
    expect(graph?.edges.some((e) => e.relation === 'Зараховано 50.00 грн')).toBe(true)
    const withoutOrders = await readDocument(
      db,
      { ...f.scope, orders: false },
      'receipt:' + f.receipt.id
    )
    expect(withoutOrders?.related.some((r) => r.id === f.financial.id)).toBe(false)
    expect(
      await readDocument(
        db,
        { ...f.scope, organizationId: randomUUID() },
        'receipt:' + f.receipt.id
      )
    ).toBeNull()
    expect((await readJournal(db, { ...f.scope, organizationId: randomUUID() }, {})).total).toBe(0)
    expect(
      await readDocument(db, { ...f.scope, accounts: [] }, 'finance:' + f.financial.id)
    ).toBeNull()
    expect(
      (
        await readJournal(
          db,
          { ...f.scope, receipts: false, orders: false, finance: false, settlements: false },
          {}
        )
      ).total
    ).toBe(0)
  })
  it('requires both transfer accounts and hides salary plus refund/reversal descendants from managers', async () => {
    const f = await setup()
    const make = (data: Record<string, unknown>) =>
      db.financialDocument.create({
        data: {
          organizationId: f.org.id,
          requestId: randomUUID(),
          fingerprint: 'test',
          kind: 'expense',
          status: 'posted',
          date,
          amount: '10',
          sourceAccountId: f.account.id,
          note: 'test',
          createdById: 'test',
          ...data,
        },
      })
    const transfer = await make({ kind: 'transfer', targetAccountId: f.hidden.id })
    expect(await readDocument(db, f.scope, 'finance:' + transfer.id)).toBeNull()
    const technician = await db.technician.create({
      data: { organizationId: f.org.id, name: 'Private salary' },
    })
    const salary = await make({})
    await db.staffPayment.create({
      data: { technicianId: technician.id, documentId: salary.id, advance: true },
    })
    const refund = await make({ kind: 'refund', originalId: salary.id })
    const reversal = await make({ kind: 'reversal', reversalOfId: refund.id })
    const slip = await db.paySlip.create({
      data: {
        technicianId: technician.id,
        start: date,
        end: date,
        total: '100',
        lines: [],
        actorId: 'test',
      },
    })
    for (const id of [salary.id, refund.id, reversal.id])
      expect(await readDocument(db, f.scope, 'finance:' + id)).toBeNull()
    expect(await readDocument(db, f.scope, 'salary:' + slip.id)).toBeNull()
    const owner = { ...f.scope, payroll: true, accounts: [f.account.id, f.hidden.id] }
    for (const id of [salary.id, refund.id, reversal.id, transfer.id])
      expect(await readDocument(db, owner, 'finance:' + id)).not.toBeNull()
    expect(await readDocument(db, owner, 'salary:' + slip.id)).not.toBeNull()
  })
  it('links service purchases and returns to their exact source documents', async () => {
    const f = await setup()
    const labor = await db.serviceLabor.create({
      data: { serviceRecordId: f.order.id, description: 'Supplier service', total: 200 },
    })
    await db.subcontractWork.create({
      data: {
        laborId: labor.id,
        supplierId: f.supplier.id,
        receiptLineId: f.receipt.lines[0].id,
        unitCost: '100',
      },
    })
    const ret = await db.supplierReturn.create({
      data: {
        id: randomUUID(),
        organizationId: f.org.id,
        receiptId: f.receipt.id,
        number: 'RETURN-001',
        date,
        reason: 'Return',
        fingerprint: 'test',
        createdById: 'test',
        lines: { create: { lineId: f.receipt.lines[0].id, quantity: '1', amount: '100' } },
      },
    })
    const graph = await readDocument(db, f.scope, 'return:' + ret.id)
    expect(graph?.document.amount).toBe('100.00')
    expect(graph?.edges.some((e) => e.relation === 'Послуга постачальника для наряду')).toBe(true)
    expect(graph?.related.map((r) => r.id)).toEqual(
      expect.arrayContaining([f.receipt.id, f.order.id])
    )
    expect(await readDocument(db, { ...f.scope, receipts: false }, 'return:' + ret.id)).toBeNull()
  })
  it('supports each permission independently without relying on the receipts source', async () => {
    const f = await setup()
    for (const subject of ['receipts', 'orders', 'finance', 'settlements', 'payroll'] as const) {
      const scope = {
        ...f.scope,
        receipts: false,
        orders: false,
        finance: false,
        settlements: false,
        payroll: false,
        [subject]: true,
      }
      const result = await readJournal(db, scope, {})
      expect(result.total).toBeGreaterThanOrEqual(0)
      for (const row of result.rows)
        expect((await readDocument(db, scope, row.key))?.document.id).toBe(row.id)
    }
  })
  it('totals repeated allocations and separates reversed allocations', async () => {
    const f = await setup()
    await db.supplierAllocation.createMany({
      data: [
        {
          creditId: f.credit.id,
          debitId: f.receipt.settlement!.id,
          amount: '50',
          date,
          createdById: 'test',
        },
        {
          creditId: f.credit.id,
          debitId: f.receipt.settlement!.id,
          amount: '25',
          date,
          createdById: 'test',
          reversedAt: date,
        },
      ],
    })
    const graph = await readDocument(db, f.scope, 'receipt:' + f.receipt.id)
    expect(graph?.edges.map((e) => e.relation)).toContain('Зараховано 100.00 грн')
    expect(graph?.edges.map((e) => e.relation)).toContain('Скасовано зарахування 25.00 грн')
  })
  it('opens a small document chain without traversing a large unrelated archive', async () => {
    const f = await setup()
    const ids = Array.from({ length: 2000 }, () => randomUUID())
    await db.serviceRecord.createMany({
      data: ids.map((id) => ({
        id,
        organizationId: f.org.id,
        title: 'Archive',
        serviceDate: date,
      })),
    })
    await db.payment.createMany({
      data: ids.map((id) => ({ serviceRecordId: id, amount: 100, date })),
    })
    const graph = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
        return readDocument(tx, f.scope, 'receipt:' + f.receipt.id)
      },
      { timeout: 15000 }
    )
    expect(graph?.related.map((row) => row.id).sort()).toEqual(
      [f.receipt.id, f.order.id, f.financial.id, f.credit.id].sort()
    )
  }, 20000)
  it('paginates deterministically without duplicate rows', async () => {
    const f = await setup()
    await db.supplierEntry.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        kind: 'adjustment_credit',
        amount: String(i + 1),
        date,
        createdById: 'test',
      })),
    })
    const a = await readJournal(db, f.scope, {}),
      b = await readJournal(db, f.scope, { page: 2 })
    expect(a.total).toBe(34)
    expect(a.rows).toHaveLength(25)
    expect(b.rows).toHaveLength(9)
    expect(new Set([...a.rows, ...b.rows].map((r) => r.key)).size).toBe(34)
  })
})
