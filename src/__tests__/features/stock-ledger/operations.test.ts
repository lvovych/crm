// @vitest-environment node
import { randomUUID as key } from 'node:crypto'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockOperations } from '@/features/stock-ledger/Lib/stock'
import { createProcurement } from '@/features/stock-ledger/Lib/procurement'
import { directoryOperations } from '@/features/stock-ledger/Lib/directories'
import { stockSummary, stockHistory } from '@/features/stock-ledger/Lib/stockReports'
import { partyStatement } from '@/features/stock-ledger/Lib/statement'
import { financialReport } from '@/features/stock-ledger/Lib/financialReport'
import { createSettlementOperations } from '@/features/stock-ledger/Lib/settlements'
import { closeLedgerPeriod, reopenLedgerPeriod } from '@/features/stock-ledger/Lib/administration'
import { createFinance } from '@/features/stock-ledger/Lib/finance'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Use isolated local crm_ledger_test')
;(url ? describe : describe.skip)('operational inventory management', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    org = key(),
    user = key(),
    ctx = { organizationId: org, userId: user },
    service = createStockLedger(db, ctx),
    directories = directoryOperations(db, ctx)
  let warehouseId: string, second: string, supplierId: string, productId: string, accountId: string
  const date = '2026-10-20'
  beforeAll(async () => {
    await db.user.create({
      data: { id: user, email: `${user}@example.test`, name: 'Operations test' },
    })
    await db.organization.create({ data: { id: org, name: 'Operations test' } })
    warehouseId = (
      await service.createWarehouse({ idempotencyKey: key(), code: 'MAIN', name: 'Main' })
    ).id
    second = (
      await service.createWarehouse({ idempotencyKey: key(), code: 'OTHER', name: 'Other' })
    ).id
    supplierId = (await service.createSupplier({ idempotencyKey: key(), name: 'Supplier' })).id
    accountId = (await service.createAccount({ idempotencyKey: key(), name: 'Account' })).id
    productId = (
      await db.inventoryPart.create({
        data: {
          organizationId: org,
          userId: user,
          name: 'Filter test',
          partNumber: 'ART-123',
          unit: 'pcs',
        },
      })
    ).id
  })
  afterAll(() => db.$disconnect())
  it('supplier edit detects stale revisions, maintains party display and restores archived records', async () => {
    const s = await service.createSupplier({ idempotencyKey: key(), name: 'Before' })
    const input = {
      idempotencyKey: key(),
      id: s.id,
      expectedVersion: 1,
      name: 'After',
      phone: '123',
      kind: 'BOTH',
      paymentTermsDays: 30,
      archived: true,
    }
    expect(await directories.supplier(input)).toEqual({ id: s.id, version: 2 })
    expect(await directories.supplier(input)).toEqual({ id: s.id, version: 2 })
    await expect(
      directories.supplier({ ...input, idempotencyKey: key(), name: 'Stale' })
    ).rejects.toThrow('змінено')
    expect(
      (await db.settlementParty.findUniqueOrThrow({ where: { id: s.partyId } })).displayNameSnapshot
    ).toBe('After')
    await directories.supplier({
      ...input,
      idempotencyKey: key(),
      expectedVersion: 2,
      archived: false,
    })
    expect((await db.supplier.findUniqueOrThrow({ where: { id: s.id } })).archivedAt).toBeNull()
  })
  it('cross-tenant directory writes fail and concurrent writes cannot overwrite', async () => {
    await expect(
      directoryOperations(db, { ...ctx, organizationId: key() }).supplier({
        idempotencyKey: key(),
        id: supplierId,
        expectedVersion: 1,
        name: 'Other',
      })
    ).rejects.toThrow()
    const results = await Promise.allSettled(
      ['One', 'Two'].map((name) =>
        directories.supplier({ idempotencyKey: key(), id: supplierId, expectedVersion: 1, name })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })
  it('default warehouse change is atomic; archive and restore a zero-stock nondefault warehouse', async () => {
    await expect(
      directories.warehouse({
        idempotencyKey: key(),
        id: warehouseId,
        expectedVersion: 1,
        name: 'Main',
        code: 'MAIN',
        isDefault: true,
        archived: true,
      })
    ).rejects.toThrow()
    await directories.warehouse({
      idempotencyKey: key(),
      id: second,
      expectedVersion: 1,
      name: 'Other',
      code: 'OTHER',
      isDefault: true,
    })
    expect(await db.warehouse.count({ where: { organizationId: org, isDefault: true } })).toBe(1)
    await directories.warehouse({
      idempotencyKey: key(),
      id: warehouseId,
      expectedVersion: 2,
      name: 'Main',
      code: 'MAIN',
      archived: true,
    })
    await directories.warehouse({
      idempotencyKey: key(),
      id: warehouseId,
      expectedVersion: 3,
      name: 'Main',
      code: 'MAIN',
      archived: false,
    })
  })
  it('account archiving requires zero balance; account kind with movements is immutable', async () => {
    await directories.account({
      idempotencyKey: key(),
      id: accountId,
      expectedVersion: 1,
      name: 'Renamed',
      archived: true,
    })
    await directories.account({
      idempotencyKey: key(),
      id: accountId,
      expectedVersion: 2,
      name: 'Renamed',
      archived: false,
    })
    await createFinance(db, ctx).openingBalance({
      idempotencyKey: key(),
      accountId,
      amount: '0.01',
      effectiveAt: date,
      sourceNote: 'Verified opening',
      batchKey: key(),
    })
    await expect(
      directories.account({
        idempotencyKey: key(),
        id: accountId,
        expectedVersion: 3,
        name: 'Renamed',
        archived: true,
      })
    ).rejects.toThrow('нульовим')
    await expect(
      directories.account({
        idempotencyKey: key(),
        id: accountId,
        expectedVersion: 3,
        name: 'Renamed',
        kind: 'CASH',
      })
    ).rejects.toThrow('історією')
  })
  async function demand(qty: number) {
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Job',
        inventoryAccountingMode: 'LEDGER',
        status: 'in-progress',
      },
    })
    const part = await db.servicePart.create({
      data: { serviceRecordId: job.id, inventoryPartId: productId, name: 'Filter', quantity: qty },
    })
    return createStockOperations(db, ctx).createDemand({
      idempotencyKey: key(),
      servicePartId: part.id,
    })
  }
  it('shows zero-stock minimums, expected purchases, normalized articles and server filters', async () => {
    const warehouseId = (
      await db.warehouse.findFirstOrThrow({ where: { organizationId: org, isDefault: true } })
    ).id
    const p = await db.inventoryPart.create({
      data: {
        organizationId: org,
        userId: user,
        name: 'Blue filter deficit',
        partNumber: 'AB-12 / C',
        unit: 'pcs',
        minQuantity: 5,
        category: 'Filters',
      },
    })
    const query = (input = {}) =>
      db.$transaction((tx) => stockSummary(tx, ctx, { search: 'AB12C', pageSize: 50, ...input }))
    let report = await query({ onlyDeficit: true })
    expect(report.rows[0]).toMatchObject({
      productId: p.id,
      onHand: '0.000',
      expected: '0.000',
      minimum: '5.000',
      deficit: '5.000',
    })
    const procurement = createProcurement(db, ctx),
      po = await procurement.saveDraft({
        idempotencyKey: key(),
        supplierId,
        warehouseId,
        lines: [{ inventoryPartId: p.id, quantity: '3', unitPrice: '1' }],
      })
    await procurement.confirm({ idempotencyKey: key(), documentId: po.id, expectedVersion: 1 })
    report = await query()
    expect(report.rows[0]).toMatchObject({
      available: '0.000',
      expected: '3.000',
      deficit: '2.000',
    })
    expect(
      (await query({ search: 'filter Blue', category: 'Filters', brand: '---' })).rows.some(
        (r) => r.productId === p.id
      )
    ).toBe(true)
    expect((await query({ category: 'wrong' })).total).toBe(0)
    expect((await query({ onlyAvailable: true })).total).toBe(0)
    await db.inventoryPart.update({ where: { id: p.id }, data: { isArchived: true } })
    expect((await query()).total).toBe(0)
    expect((await query({ includeArchived: true })).total).toBe(1)
  })
  it('amends confirmed purchase quantity with version, received/draft floor and audit', async () => {
    const productId = (
      await db.inventoryPart.create({
        data: { organizationId: org, userId: user, name: 'Amend isolated', unit: 'pcs' },
      })
    ).id
    const procurement = createProcurement(db, ctx)
    const po = await procurement.saveDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      lines: [{ inventoryPartId: productId, quantity: '2', unitPrice: '10' }],
    })
    await procurement.confirm({ idempotencyKey: key(), documentId: po.id, expectedVersion: 1 })
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } })
    const input = {
      idempotencyKey: key(),
      documentId: po.id,
      expectedVersion: 2,
      lineId: line.id,
      quantity: '3',
      reason: 'Supplier confirmed additional item',
    }
    const result = await procurement.amendQuantity(input)
    expect(result.before).toBe('2')
    expect(result.after).toBe('3')
    expect(await procurement.amendQuantity(input)).toEqual(result)
    await expect(
      procurement.amendQuantity({ ...input, idempotencyKey: key(), quantity: '4' })
    ).rejects.toThrow('змінено')
    const receipt = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: date,
      externalDate: date,
      externalNumber: key(),
      dueDate: date,
      lines: [
        {
          inventoryPartId: productId,
          purchaseOrderLineId: line.id,
          quantity: '3',
          unitPrice: '10',
        },
      ],
    })
    await expect(
      procurement.amendQuantity({
        ...input,
        idempotencyKey: key(),
        expectedVersion: 3,
        quantity: '2',
      })
    ).rejects.toThrow('менша')
    await service.postReceipt({ idempotencyKey: key(), documentId: receipt.id, expectedVersion: 1 })
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe(
      'RECEIVED'
    )
  })
  it('partial purchase receipts allocate remaining needs once across drafts, reserve on posting, leave surplus free', async () => {
    const a = await demand(2),
      b = await demand(3),
      procurement = createProcurement(db, ctx)
    const po = await procurement.saveDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      lines: [
        {
          inventoryPartId: productId,
          quantity: '6',
          unitPrice: '10',
          allocations: [
            { demandId: a.id, quantity: '2' },
            { demandId: b.id, quantity: '3' },
          ],
        },
      ],
    })
    await procurement.confirm({ idempotencyKey: key(), documentId: po.id, expectedVersion: 1 })
    const pol = await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } })
    const draft = (quantity: string) =>
      service.saveReceiptDraft({
        idempotencyKey: key(),
        supplierId,
        warehouseId,
        effectiveAt: date,
        externalDate: date,
        dueDate: date,
        externalNumber: key(),
        autoAllocatePurchase: true,
        lines: [
          { inventoryPartId: productId, purchaseOrderLineId: pol.id, quantity, unitPrice: '10' },
        ],
      })
    const one = await draft('3'),
      two = await draft('3')
    const allocations = await db.receiptDemandAllocation.findMany({
      where: { organizationId: org, receiptLine: { documentId: { in: [one.id, two.id] } } },
    })
    expect(
      allocations.filter((x) => x.demandId === a.id).reduce((n, x) => n + x.quantity.toNumber(), 0)
    ).toBe(2)
    expect(
      allocations.filter((x) => x.demandId === b.id).reduce((n, x) => n + x.quantity.toNumber(), 0)
    ).toBe(3)
    await expect(draft('1')).rejects.toThrow('чернетку')
    expect(await db.stockReservation.count({ where: { organizationId: org } })).toBe(0)
    await expect(
      directories.supplier({
        idempotencyKey: key(),
        id: supplierId,
        expectedVersion: 2,
        name: 'Supplier',
        archived: true,
      })
    ).rejects.toThrow('чернетки')
    for (const d of [two, one])
      await service.postReceipt({ idempotencyKey: key(), documentId: d.id, expectedVersion: 1 })
    const reservations = await db.stockReservation.aggregate({
      where: { organizationId: org },
      _sum: { remainingQuantity: true },
    })
    expect(reservations._sum.remainingQuantity?.toString()).toBe('5')
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe(
      'RECEIVED'
    )
  })
  it('summary combines lots with accurate free stock; search and history are tenant-scoped and cost-free', async () => {
    const report = await db.$transaction((tx) =>
      stockSummary(tx, ctx, { search: 'ART-123', warehouseId })
    )
    expect(report.total).toBe(1)
    expect(report.rows[0]).toMatchObject({ onHand: '6.000', reserved: '5.000', available: '1.000' })
    expect(report.rows[0]).not.toHaveProperty('unitCost')
    expect(
      (await db.$transaction((tx) => stockSummary(tx, ctx, { search: "' OR 1=1 --" }))).total
    ).toBe(0)
    expect(
      (await db.$transaction((tx) => stockSummary(tx, { ...ctx, organizationId: key() }, {}))).rows
    ).toEqual([])
    const history = await db.$transaction((tx) =>
      stockHistory(tx, ctx, { productId, warehouseId, from: date, through: date })
    )
    expect(history.total).toBe(2)
    expect(history.rows.every((r) => r.kind === 'RECEIPT')).toBe(true)
    expect(
      (
        await db.$transaction((tx) =>
          stockHistory(tx, { ...ctx, organizationId: key() }, { productId, warehouseId })
        )
      ).rows
    ).toEqual([])
    await expect(
      db.$transaction((tx) =>
        stockHistory(tx, ctx, { productId, warehouseId, from: '2026-10-21', through: date })
      )
    ).rejects.toThrow()
    await expect(
      directories.warehouse({
        idempotencyKey: key(),
        id: warehouseId,
        expectedVersion: 4,
        name: 'Main',
        code: 'MAIN',
        archived: true,
      })
    ).rejects.toThrow('залишки')
    await expect(
      directories.warehouse({
        idempotencyKey: key(),
        id: warehouseId,
        expectedVersion: 4,
        name: 'Main',
        code: 'MAIN',
        reservable: false,
      })
    ).rejects.toThrow('резерви')
  })
  it('as-of report reconstructs debt and cash before and after a later reversal', async () => {
    const supplier = await service.createSupplier({ idempotencyKey: key(), name: 'As-of supplier' })
    const draft = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId: supplier.id,
      warehouseId,
      effectiveAt: '2026-10-18',
      externalDate: '2026-10-18',
      dueDate: '2026-10-18',
      externalNumber: key(),
      lines: [{ inventoryPartId: productId, quantity: '1', unitPrice: '100' }],
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    const debit = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: draft.id },
    })
    const pay = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId: supplier.partyId,
      accountId,
      amount: '20',
      direction: 'OUT',
      effectiveAt: '2026-10-19',
      method: 'bank',
    })
    await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: debit.id,
      creditEntryId: pay.entryId,
      amount: '20',
      effectiveAt: '2026-10-19',
    })
    await createSettlementOperations(db, ctx).reversePayment({
      idempotencyKey: key(),
      id: pay.id,
      effectiveAt: '2026-10-20',
      reason: 'Incorrect payment',
    })
    const at = async (through: string) =>
      db.$transaction((tx) => financialReport(tx, ctx, { through }))
    expect((await at('2026-10-17')).parties.find((p) => p.id === supplier.partyId)).toBeUndefined()
    expect((await at('2026-10-18')).parties.find((p) => p.id === supplier.partyId)).toMatchObject({
      debt: '100.00',
      advance: '0.00',
      balance: '100.00',
    })
    expect((await at('2026-10-19')).parties.find((p) => p.id === supplier.partyId)).toMatchObject({
      debt: '80.00',
      advance: '0.00',
      balance: '80.00',
      overdue: '80.00',
      notDue: '0.00',
      nearestDue: '2026-10-18',
    })
    expect((await at('2026-10-20')).parties.find((p) => p.id === supplier.partyId)).toMatchObject({
      debt: '100.00',
      advance: '0.00',
      balance: '100.00',
    })
    const statement = await db.$transaction((tx) =>
      partyStatement(tx, ctx, {
        partyId: supplier.partyId,
        from: '2026-10-19',
        through: '2026-10-19',
      })
    )
    expect(statement.opening).toBe('100.00')
    expect(statement.closing).toBe('80.00')
    expect(statement.credit).toBe('20.00')
    expect(statement.rows).toHaveLength(1)
    await expect(
      db.$transaction((tx) =>
        partyStatement(
          tx,
          { ...ctx, organizationId: key() },
          { partyId: supplier.partyId, from: '2026-10-19', through: '2026-10-19' }
        )
      )
    ).rejects.toThrow()
    expect((await at('2026-10-19')).cash.find((c) => c.id === accountId)?.balance).toBe('-20.00')
    expect((await at('2026-10-20')).cash.find((c) => c.id === accountId)?.balance).toBe('0.01')
    expect((await at('2026-10-20')).errors).toEqual([])
    expect(
      (
        await db.$transaction((tx) =>
          financialReport(tx, { ...ctx, organizationId: key() }, { through: date })
        )
      ).parties
    ).toEqual([])
  })
  it('period closing blocks old financial postings and cannot move backwards', async () => {
    const input = {
      idempotencyKey: key(),
      through: date,
      area: 'BOTH',
      reason: 'Verified period close',
      confirmed: true,
    }
    const result = await closeLedgerPeriod(db, ctx, input)
    expect(await closeLedgerPeriod(db, ctx, input)).toEqual(result)
    expect(result.inventoryClosedThrough).toBe(date)
    await expect(
      closeLedgerPeriod(db, ctx, { ...input, idempotencyKey: key(), through: '2026-10-19' })
    ).rejects.toThrow('відкриття')
    await expect(
      closeLedgerPeriod(db, ctx, { ...input, idempotencyKey: key(), through: '2099-01-01' })
    ).rejects.toThrow('минулий')
    await expect(
      createFinance(db, ctx).openingBalance({
        idempotencyKey: key(),
        accountId,
        amount: '1',
        effectiveAt: date,
        sourceNote: 'Verified balance',
        batchKey: key(),
      })
    ).rejects.toThrow('закритий')
  })
  it('explicit audited reopening moves only selected boundary and leaves historical entries intact', async () => {
    const before = await db.inventoryLedgerEntry.count({ where: { organizationId: org } })
    const input = {
      idempotencyKey: key(),
      from: '2026-10-20',
      area: 'FINANCE',
      reason: 'Approved late invoice',
      confirmed: true,
    }
    const result = await reopenLedgerPeriod(db, ctx, input)
    expect(result.before.finance).toBe(date)
    expect(await reopenLedgerPeriod(db, ctx, input)).toEqual(result)
    const lock = await db.accountingPeriodLock.findUniqueOrThrow({ where: { organizationId: org } })
    expect(lock.financeClosedThrough?.toISOString().slice(0, 10)).toBe('2026-10-19')
    expect(lock.inventoryClosedThrough?.toISOString().slice(0, 10)).toBe(date)
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: org } })).toBe(before)
    await expect(reopenLedgerPeriod(db, ctx, { ...input, idempotencyKey: key() })).rejects.toThrow(
      'вже відкрита'
    )
  })
})
