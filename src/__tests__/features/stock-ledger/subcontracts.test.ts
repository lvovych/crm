import { randomUUID as key } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { subcontractOperations } from '@/features/stock-ledger/Lib/subcontracts'
import { createFinance } from '@/features/stock-ledger/Lib/finance'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('subcontract lifecycle', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    ctx = { organizationId: key(), userId: key() },
    ops = subcontractOperations(db, ctx),
    ledger = createStockLedger(db, ctx)
  let supplierId: string, partyId: string, job: string, labor: string
  beforeAll(async () => {
    await db.user.create({
      data: { id: ctx.userId, name: 'Subcontract', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Subcontract' } })
    const supplier = await ledger.createSupplier({
      idempotencyKey: key(),
      name: 'Subcontract supplier',
      kind: 'SERVICES',
    })
    supplierId = supplier.id
    partyId = supplier.partyId
    job = (
      await db.serviceRecord.create({
        data: { organizationId: ctx.organizationId, title: 'Subcontract job' },
      })
    ).id
    labor = (
      await db.serviceLabor.create({
        data: {
          serviceRecordId: job,
          description: 'Repair',
          total: 3800,
          executionType: 'SUBCONTRACT',
        },
      })
    ).id
  })
  afterAll(() => db.$disconnect())
  const payload = () => ({
    idempotencyKey: key(),
    supplierId,
    externalNumber: key(),
    effectiveAt: '2026-10-20',
    dueDate: '2026-10-25',
    lines: [
      {
        serviceRecordId: job,
        serviceLaborId: labor,
        description: 'External repair',
        quantity: '3',
        unitCost: '0.335',
        taxMode: 'EXCLUSIVE',
        taxRate: '20',
      },
    ],
  })
  it('draft has no AP; rounded tax, versions, cancellation and repeated posting are atomic', async () => {
    const draft = await ops.save(payload())
    expect(draft.total).toBe('1.21')
    expect(await db.settlementEntry.count({ where: { supplierServiceDocumentId: draft.id } })).toBe(
      0
    )
    const p = payload()
    const edited = await ops.save({ ...p, id: draft.id, expectedVersion: 1 })
    await expect(
      ops.transition({ idempotencyKey: key(), id: draft.id, expectedVersion: 1 })
    ).rejects.toThrow('змінено')
    const input = { idempotencyKey: key(), id: draft.id, expectedVersion: edited.version }
    const [a, b] = await Promise.all([ops.transition(input), ops.transition(input)])
    expect(a).toEqual(b)
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { supplierServiceDocumentId: draft.id },
    })
    expect(entry.amount.toFixed(2)).toBe('1.21')
    const line = await db.supplierServiceLine.findFirstOrThrow({ where: { documentId: draft.id } })
    expect(line.netAmount.toFixed(2)).toBe('1.01')
    expect(line.taxAmount.toFixed(2)).toBe('0.20')
    await expect(
      db.supplierServiceLine.update({ where: { id: line.id }, data: { unitCost: '2' } })
    ).rejects.toThrow()
    await expect(ops.save({ ...p, id: draft.id, expectedVersion: a.version })).rejects.toThrow()
    const cancelled = await ops.save(payload())
    await ops.transition({ idempotencyKey: key(), id: cancelled.id, expectedVersion: 1 }, true)
    await expect(
      ops.transition({ idempotencyKey: key(), id: cancelled.id, expectedVersion: 2 })
    ).rejects.toThrow()
    expect(
      await db.settlementEntry.count({ where: { supplierServiceDocumentId: cancelled.id } })
    ).toBe(0)
  })
  it('paid act reversal releases payment as advance, preserves cash and sale, and cannot repeat under a new key', async () => {
    const draft = await ops.save(payload())
    const posted = await ops.transition({ idempotencyKey: key(), id: draft.id, expectedVersion: 1 })
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { supplierServiceDocumentId: draft.id },
    })
    const account = await ledger.createAccount({ idempotencyKey: key(), name: 'Cash' })
    const payment = await ledger.postMoneyTransaction({
      idempotencyKey: key(),
      partyId,
      accountId: account.id,
      direction: 'OUT',
      amount: '1.21',
      effectiveAt: '2026-10-21',
      method: 'cash',
    })
    const credit = await db.settlementEntry.findFirstOrThrow({
      where: { moneyTransactionId: payment.id },
    })
    await ledger.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: entry.id,
      creditEntryId: credit.id,
      amount: '1.21',
      effectiveAt: '2026-10-21',
    })
    await expect(
      ops.reverse({
        idempotencyKey: key(),
        id: draft.id,
        expectedVersion: posted.version,
        effectiveAt: '2026-10-20',
        reason: 'Incorrect supplier',
      })
    ).rejects.toThrow('рознесенню')
    const input = {
      idempotencyKey: key(),
      id: draft.id,
      expectedVersion: posted.version,
      effectiveAt: '2026-10-22',
      reason: 'Incorrect supplier',
    }
    const reversal = await ops.reverse(input)
    expect(await ops.reverse(input)).toEqual(reversal)
    await expect(ops.reverse({ ...input, idempotencyKey: key() })).rejects.toThrow('недоступний')
    expect(
      await db.settlementAllocation.count({ where: { creditEntryId: credit.id, reversedAt: null } })
    ).toBe(0)
    expect(
      (
        await db.cashLedgerEntry.aggregate({
          where: { accountId: account.id },
          _sum: { amountDelta: true },
        })
      )._sum.amountDelta?.toFixed(2)
    ).toBe('-1.21')
    expect((await db.serviceLabor.findUniqueOrThrow({ where: { id: labor } })).total).toBe(3800)
    expect(
      await db.inventoryLedgerEntry.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(0)
  })
  it('direct posting honors inclusive tax and rolls back invalid or foreign references', async () => {
    const p = payload()
    p.lines[0].taxMode = 'INCLUSIVE'
    p.lines[0].unitCost = '1'
    p.lines[0].quantity = '1'
    const posted = await createFinance(db, ctx).postSubcontract(p)
    expect(posted.total).toBe('1.00')
    const line = await db.supplierServiceLine.findFirstOrThrow({ where: { documentId: posted.id } })
    expect(line.taxAmount.toFixed(2)).toBe('0.17')
    expect(line.netAmount.toFixed(2)).toBe('0.83')
    await expect(
      subcontractOperations(db, { ...ctx, organizationId: key() }).transition({
        idempotencyKey: key(),
        id: posted.id,
        expectedVersion: 1,
      })
    ).rejects.toThrow()
    const invalid = payload()
    invalid.lines[0].taxRate = '101'
    await expect(ops.save(invalid)).rejects.toThrow('ставка')
  })
})
