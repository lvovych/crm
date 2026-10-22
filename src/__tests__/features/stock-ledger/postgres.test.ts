import { reverseReceipt } from '@/features/stock-ledger/Lib/reverseReceipt'
import { previewImport, commitImport } from '@/features/stock-ledger/Lib/importService'
import { createFinance } from '@/features/stock-ledger/Lib/finance'
import { createStockAdjustments } from '@/features/stock-ledger/Lib/adjustments'
import { reconciliation } from '@/features/stock-ledger/Lib/reconciliation'
import { createProcurement } from '@/features/stock-ledger/Lib/procurement'
import { returnToSupplier } from '@/features/stock-ledger/Lib/supplierReturns'
import { createSettlementOperations } from '@/features/stock-ledger/Lib/settlements'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockOperations } from '@/features/stock-ledger/Lib/stock'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
const url = process.env.LEDGER_TEST_DATABASE_URL
// Deliberately never use DATABASE_URL: this suite must not touch a real workshop.
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Use the isolated local crm_ledger_test database')
const suite = url ? describe : describe.skip
suite('PostgreSQL supplier ledger', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const org = randomUUID(),
    user = randomUUID(),
    otherOrg = randomUUID()
  const ctx = { organizationId: org, userId: user },
    service = createStockLedger(db, ctx)
  let supplierId: string,
    partyId: string,
    warehouseId: string,
    accountId: string,
    productId: string,
    receiptId: string,
    debitId: string
  const key = () => randomUUID()
  beforeAll(async () => {
    await db.user.create({ data: { id: user, email: `${user}@example.test`, name: 'Ledger test' } })
    await db.organization.createMany({
      data: [
        { id: org, name: 'Ledger test' },
        { id: otherOrg, name: 'Other tenant' },
      ],
    })
    const s = await service.createSupplier({ idempotencyKey: key(), name: 'Test supplier' })
    supplierId = s.id
    partyId = s.partyId
    warehouseId = (
      await service.createWarehouse({ idempotencyKey: key(), code: 'MAIN', name: 'Main' })
    ).id
    accountId = (await service.createAccount({ idempotencyKey: key(), name: 'Bank' })).id
    productId = (
      await db.inventoryPart.create({
        data: { name: 'Part', organizationId: org, userId: user, unit: 'pcs' },
      })
    ).id
  })
  afterAll(() => db.$disconnect())
  it('AC01: draft has no effect, post is atomic and idempotent', async () => {
    const draft = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-20',
      externalNumber: 'TEST-1',
      externalDate: '2026-10-20',
      dueDate: '2026-10-30',
      lines: [{ inventoryPartId: productId, quantity: '10', unitPrice: '200' }],
    })
    receiptId = draft.id
    expect(await db.stockLot.count({ where: { organizationId: org } })).toBe(0)
    expect(await db.settlementEntry.count({ where: { organizationId: org } })).toBe(0)
    const command = { idempotencyKey: key(), documentId: receiptId, expectedVersion: 1 }
    const results = await Promise.all([service.postReceipt(command), service.postReceipt(command)])
    expect(results[0]).toEqual(results[1])
    const balance = await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: org } })
    expect(balance.onHandQty.toFixed(3)).toBe('10.000')
    const debit = await db.settlementEntry.findFirstOrThrow({ where: { organizationId: org } })
    debitId = debit.id
    expect(debit.amount.toFixed(2)).toBe('2000.00')
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: org } })).toBe(1)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: productId } })).quantity).toBe(
      0
    )
    await expect(service.postReceipt({ ...command, expectedVersion: 2 })).rejects.toThrow('ключ')
  })
  it('AC07/08: partial payments and advance remain separate, concurrent over-allocation fails', async () => {
    const p1 = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId,
      accountId,
      direction: 'OUT',
      amount: '1200',
      effectiveAt: '2026-10-21',
      method: 'bank',
    })
    await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: debitId,
      creditEntryId: p1.entryId,
      amount: '1200',
      effectiveAt: '2026-10-21',
    })
    const p2 = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId,
      accountId,
      direction: 'OUT',
      amount: '1000',
      effectiveAt: '2026-10-21',
      method: 'bank',
    })
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.allocateSettlement({
          idempotencyKey: key(),
          debitEntryId: debitId,
          creditEntryId: p2.entryId,
          amount: '800',
          effectiveAt: '2026-10-21',
        })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const applied = await db.settlementAllocation.aggregate({
      where: { organizationId: org, creditEntryId: p2.entryId },
      _sum: { amount: true },
    })
    expect(applied._sum.amount?.toFixed(2)).toBe('800.00')
    const cash = await db.cashLedgerEntry.aggregate({
      where: { organizationId: org },
      _sum: { amountDelta: true },
    })
    expect(cash._sum.amountDelta?.toFixed(2)).toBe('-2200.00')
  })
  it('AC14: another tenant cannot read/write references; composite FK enforces scope', async () => {
    await expect(
      createStockLedger(db, { ...ctx, organizationId: otherOrg }).postReceipt({
        idempotencyKey: key(),
        documentId: receiptId,
        expectedVersion: 1,
      })
    ).rejects.toThrow('не знайдений')
    await expect(
      db.stockLotBalance.create({
        data: {
          organizationId: otherOrg,
          warehouseId,
          lotId: (await db.stockLot.findFirstOrThrow({ where: { organizationId: org } })).id,
          onHandQty: '1',
        },
      })
    ).rejects.toThrow()
  })
  it('posted documents, lines and ledger are immutable in SQL', async () => {
    await expect(
      db.inventoryDocument.update({ where: { id: receiptId }, data: { note: 'rewrite' } })
    ).rejects.toThrow()
    const line = await db.inventoryDocumentLine.findFirstOrThrow({
      where: { documentId: receiptId },
    })
    await expect(
      db.inventoryDocumentLine.update({ where: { id: line.id }, data: { unitPrice: '1' } })
    ).rejects.toThrow()
    await expect(
      db.inventoryLedgerEntry.deleteMany({ where: { organizationId: org } })
    ).rejects.toThrow()
  })
  it('AC18: failed payment leaves no money or settlement entries', async () => {
    const before = await db.moneyTransaction.count({ where: { organizationId: org } })
    await expect(
      service.postMoneyTransaction({
        idempotencyKey: key(),
        partyId,
        accountId: 'missing',
        direction: 'OUT',
        amount: '5',
        effectiveAt: '2026-10-21',
        method: 'bank',
      })
    ).rejects.toThrow()
    expect(await db.moneyTransaction.count({ where: { organizationId: org } })).toBe(before)
  })
  it('AC02/03/06/12: reserve, issue, return and transfer preserve stock and original cost', async () => {
    const stock = createStockOperations(db, ctx)
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Ledger job',
        status: 'in-progress',
        inventoryAccountingMode: 'LEDGER',
      },
    })
    const part = await db.servicePart.create({
      data: { serviceRecordId: job.id, inventoryPartId: productId, name: 'Part', quantity: 2 },
    })
    const demand = await stock.createDemand({ idempotencyKey: key(), servicePartId: part.id })
    const reserve = {
      idempotencyKey: key(),
      demandId: demand.id,
      warehouseId,
      quantity: '2',
      effectiveAt: '2026-10-21',
    }
    await stock.reserve(reserve)
    let balance = await db.stockLotBalance.findFirstOrThrow({
      where: { organizationId: org, warehouseId },
    })
    expect(balance.onHandQty.toString()).toBe('10')
    expect(balance.reservedQty.toString()).toBe('2')
    await expect(
      db.servicePart.update({ where: { id: part.id }, data: { quantity: 1 } })
    ).rejects.toThrow()
    await expect(
      db.serviceRecord.update({ where: { id: job.id }, data: { status: 'completed' } })
    ).rejects.toThrow()
    const issued = await stock.issue({ ...reserve, idempotencyKey: key() })
    expect(issued.cost).toBe('400.000000')
    balance = await db.stockLotBalance.findFirstOrThrow({ where: { id: balance.id } })
    expect(balance.onHandQty.toString()).toBe('8')
    expect(balance.reservedQty.toString()).toBe('0')
    await db.serviceRecord.update({ where: { id: job.id }, data: { status: 'completed' } })
    await db.serviceRecord.update({ where: { id: job.id }, data: { status: 'in-progress' } })
    await db.inventoryPart.update({ where: { id: productId }, data: { unitCost: 999 } })
    const issueAllocation = await db.documentLotAllocation.findFirstOrThrow({
      where: { organizationId: org, demandId: demand.id },
    })
    await stock.returnFromWorkOrder({
      idempotencyKey: key(),
      allocationId: issueAllocation.id,
      warehouseId,
      quantity: '1',
      effectiveAt: '2026-10-21',
      reason: 'Unused',
    })
    await expect(
      stock.returnFromWorkOrder({
        idempotencyKey: key(),
        allocationId: issueAllocation.id,
        warehouseId,
        quantity: '2',
        effectiveAt: '2026-10-21',
        reason: 'Too many',
      })
    ).rejects.toThrow()
    const returnEntry = await db.inventoryLedgerEntry.findFirstOrThrow({
      where: { organizationId: org, documentLine: { document: { kind: 'WORK_ORDER_RETURN' } } },
    })
    expect(returnEntry.costAmountDelta.toString()).toBe('200')
    const otherWarehouse = (
      await service.createWarehouse({ idempotencyKey: key(), code: 'SECOND', name: 'Second' })
    ).id
    await stock.transfer({
      idempotencyKey: key(),
      lotId: balance.lotId,
      sourceWarehouseId: warehouseId,
      targetWarehouseId: otherWarehouse,
      quantity: '3',
      effectiveAt: '2026-10-21',
    })
    const total = await db.stockLotBalance.aggregate({
      where: { organizationId: org },
      _sum: { onHandQty: true },
    })
    expect(total._sum.onHandQty?.toString()).toBe('9')
    const races = await Promise.allSettled(
      [1, 2].map(() =>
        stock.reserve({
          idempotencyKey: key(),
          demandId: demand.id,
          warehouseId,
          quantity: '1',
          effectiveAt: '2026-10-21',
        })
      )
    )
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })
  it('AC04/05: partial procurement receipt reserves a specific lot without duplicating work-order parts', async () => {
    const procurement = createProcurement(db, ctx),
      stock = createStockOperations(db, ctx)
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Purchase job',
        status: 'in-progress',
        inventoryAccountingMode: 'LEDGER',
      },
    })
    const part = await db.servicePart.create({
      data: { serviceRecordId: job.id, inventoryPartId: productId, name: 'Part', quantity: 5 },
    })
    const demand = await stock.createDemand({ idempotencyKey: key(), servicePartId: part.id })
    const order = await procurement.saveDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      lines: [
        {
          inventoryPartId: productId,
          quantity: '5',
          unitPrice: '100',
          allocations: [{ demandId: demand.id, quantity: '5' }],
        },
      ],
    })
    await procurement.confirm({ idempotencyKey: key(), documentId: order.id, expectedVersion: 1 })
    const poLine = await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: order.id } })
    const pa = await db.purchaseDemandAllocation.findFirstOrThrow({
      where: { purchaseOrderLineId: poLine.id },
    })
    const receipt = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-21',
      externalNumber: 'PURCHASE-TEST',
      externalDate: '2026-10-21',
      dueDate: '2026-10-30',
      lines: [
        {
          inventoryPartId: productId,
          purchaseOrderLineId: poLine.id,
          quantity: '2',
          unitPrice: '100',
        },
      ],
    })
    const line = await db.inventoryDocumentLine.findFirstOrThrow({
      where: { documentId: receipt.id },
    })
    await procurement.allocateReceipt({
      idempotencyKey: key(),
      documentId: receipt.id,
      expectedVersion: 1,
      allocations: [
        { receiptLineId: line.id, demandId: demand.id, quantity: '2', purchaseAllocationId: pa.id },
      ],
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: receipt.id, expectedVersion: 2 })
    const updated = await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PARTIALLY_RECEIVED')
    expect(
      (
        await db.purchaseDemandAllocation.findUniqueOrThrow({ where: { id: pa.id } })
      ).fulfilledQty.toString()
    ).toBe('2')
    expect(await db.servicePart.count({ where: { serviceRecordId: job.id } })).toBe(1)
    const reservation = await db.stockReservation.findFirstOrThrow({
      where: { demandId: demand.id },
    })
    expect(reservation.remainingQuantity.toString()).toBe('2')
    await procurement.cancelRemainder({
      idempotencyKey: key(),
      documentId: order.id,
      expectedVersion: updated.version,
    })
    expect(
      (
        await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLine.id } })
      ).qtyCancelled.toString()
    ).toBe('3')
  })
  it('AC09: supplier return creates a separate credit and cannot use reserved stock', async () => {
    const balance = await db.stockLotBalance.findFirstOrThrow({
      where: { organizationId: org, warehouseId, onHandQty: { gte: 2 }, reservedQty: { lt: 2 } },
      include: { lot: true },
    })
    const result = await returnToSupplier(db, ctx, {
      idempotencyKey: key(),
      lotId: balance.lotId,
      warehouseId,
      quantity: '1',
      effectiveAt: '2026-10-22',
      reason: 'Defective',
    })
    expect(result.credit).toBe('200.00')
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: result.id },
    })
    expect(entry.polarity).toBe('CREDIT')
  })
  it('payment reversal restores debt with opposite cash entries and retains originals', async () => {
    const payment = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId,
      accountId,
      direction: 'OUT',
      amount: '50',
      effectiveAt: '2026-10-22',
      method: 'bank',
    })
    const reversal = await createSettlementOperations(db, ctx).reversePayment({
      idempotencyKey: key(),
      id: payment.id,
      effectiveAt: '2026-10-22',
      reason: 'Mistake',
    })
    expect(
      (await db.moneyTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status
    ).toBe('REVERSED')
    const sum = await db.cashLedgerEntry.aggregate({
      where: { moneyTransactionId: { in: [payment.id, reversal.id] } },
      _sum: { amountDelta: true },
    })
    expect(sum._sum.amountDelta?.toString()).toBe('0')
  })
  it('AC11: subcontract costs create AP without changing stock or client price', async () => {
    const finance = createFinance(db, ctx)
    const supplier = await service.createSupplier({
      idempotencyKey: key(),
      name: 'Subcontractor',
      kind: 'SERVICES',
    })
    const job = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Subcontract job', totalAmount: 3800 },
    })
    const before = await db.inventoryLedgerEntry.count({ where: { organizationId: org } })
    const result = await finance.postSubcontract({
      idempotencyKey: key(),
      supplierId: supplier.id,
      externalNumber: 'SC-1',
      effectiveAt: '2026-10-22',
      dueDate: '2026-10-30',
      lines: [
        {
          serviceRecordId: job.id,
          description: 'External repair',
          quantity: '1',
          unitCost: '3000',
        },
      ],
    })
    expect(result.total).toBe('3000.00')
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: org } })).toBe(before)
    expect((await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).totalAmount).toBe(
      3800
    )
  })
  it('opening stock and verified stock-count adjustment do not invent supplier debt', async () => {
    const adjustments = createStockAdjustments(db, ctx)
    const product = await db.inventoryPart.create({
      data: { organizationId: org, userId: user, name: 'Opening part', unit: 'pcs' },
    })
    const before = await db.settlementEntry.count({ where: { organizationId: org } })
    await adjustments.opening({
      idempotencyKey: key(),
      warehouseId,
      effectiveAt: '2026-10-22',
      reason: 'Approved opening stock',
      lines: [{ inventoryPartId: product.id, quantity: '5', unitPrice: '100' }],
    })
    const balance = await db.stockLotBalance.findFirstOrThrow({
      where: { organizationId: org, lot: { inventoryPartId: product.id } },
    })
    await adjustments.adjust({
      idempotencyKey: key(),
      balanceId: balance.id,
      expectedVersion: balance.version,
      countedQuantity: '4',
      effectiveAt: '2026-10-22',
      reason: 'Verified physical count',
    })
    await expect(
      adjustments.adjust({
        idempotencyKey: key(),
        balanceId: balance.id,
        expectedVersion: balance.version,
        countedQuantity: '3',
        effectiveAt: '2026-10-22',
        reason: 'Stale physical count',
      })
    ).rejects.toThrow('Повторіть')
    expect(await db.settlementEntry.count({ where: { organizationId: org } })).toBe(before)
  })
  it('AC18: over-receipt failure after provisional lot inserts rolls the entire transaction back', async () => {
    const procurement = createProcurement(db, ctx)
    const order = await procurement.saveDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      lines: [{ inventoryPartId: productId, quantity: '1', unitPrice: '100' }],
    })
    await procurement.confirm({ idempotencyKey: key(), documentId: order.id, expectedVersion: 1 })
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: order.id } })
    const receipt = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-22',
      externalNumber: 'OVER-RECEIPT',
      externalDate: '2026-10-22',
      dueDate: '2026-10-30',
      lines: [
        {
          inventoryPartId: productId,
          purchaseOrderLineId: line.id,
          quantity: '2',
          unitPrice: '100',
        },
      ],
    })
    await expect(
      service.postReceipt({ idempotencyKey: key(), documentId: receipt.id, expectedVersion: 1 })
    ).rejects.toThrow('перевищує')
    expect(
      await db.stockLot.count({
        where: { organizationId: org, sourceLine: { documentId: receipt.id } },
      })
    ).toBe(0)
    expect(
      await db.settlementEntry.count({
        where: { organizationId: org, inventoryDocumentId: receipt.id },
      })
    ).toBe(0)
    expect(
      (await db.inventoryDocument.findUniqueOrThrow({ where: { id: receipt.id } })).status
    ).toBe('DRAFT')
  })
  it('AC18: inventory projections reconcile to journal and active reservations', async () => {
    const differences = await db.$transaction((tx) => reconciliation(tx, ctx))
    expect(differences).toEqual([])
  })
  it('AC15: import matches normalized SKU, creates only one draft, never posts stock', async () => {
    await db.inventoryPart.update({ where: { id: productId }, data: { partNumber: 'IM-123' } })
    const input = {
      supplierId,
      name: 'receipt.csv',
      format: 'csv' as const,
      bytes: Buffer.from('Артикул;Бренд;Кількість;Ціна\nIM123;---;2;50'),
      mapping: { article: 'Артикул', brand: 'Бренд', quantity: 'Кількість', unitPrice: 'Ціна' },
    }
    const preview = await previewImport(db, ctx, input)
    expect(preview.errorCount).toBe(0)
    expect((await previewImport(db, ctx, input)).id).toBe(preview.id)
    const before = await db.inventoryLedgerEntry.count({ where: { organizationId: org } })
    const command = {
      jobId: preview.id,
      warehouseId,
      effectiveAt: '2026-10-21',
      externalDate: '2026-10-21',
      dueDate: '2026-10-30',
      externalNumber: 'IMPORTED-1',
    }
    const first = await commitImport(db, ctx, command)
    const second = await commitImport(db, ctx, command)
    expect(second.id).toBe(first.id)
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: org } })).toBe(before)
    expect(
      await db.inventoryDocument.count({
        where: { organizationId: org, externalNumber: 'IMPORTED-1' },
      })
    ).toBe(1)
    await expect(commitImport(db, { ...ctx, organizationId: otherOrg }, command)).rejects.toThrow(
      'не знайдений'
    )
  })
  it('AC13: receipt reversal preserves source, offsets AP and blocks dependent movements', async () => {
    const draft = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-21',
      externalDate: '2026-10-21',
      dueDate: '2026-10-30',
      externalNumber: 'REVERSE-TEST',
      lines: [{ inventoryPartId: productId, quantity: '3', unitPrice: '75' }],
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    const command = {
      idempotencyKey: key(),
      id: draft.id,
      effectiveAt: '2026-10-22',
      reason: 'Помилка постачальника',
    }
    const reverse = await reverseReceipt(db, ctx, command)
    expect((await reverseReceipt(db, ctx, command)).id).toBe(reverse.id)
    expect((await db.inventoryDocument.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'REVERSED'
    )
    const lot = await db.stockLot.findFirstOrThrow({
      where: { organizationId: org, sourceLine: { documentId: draft.id } },
    })
    const entries = await db.inventoryLedgerEntry.aggregate({
      where: { organizationId: org, lotId: lot.id },
      _sum: { quantityDelta: true, costAmountDelta: true },
    })
    expect(entries._sum.quantityDelta?.toString()).toBe('0')
    expect(entries._sum.costAmountDelta?.toString()).toBe('0')
    expect(await db.inventoryDocumentLine.count({ where: { documentId: draft.id } })).toBe(1)
    await expect(
      reverseReceipt(db, ctx, { ...command, id: receiptId, idempotencyKey: key() })
    ).rejects.toThrow('залежні')
  })

  it('rejects fractional pieces, backdated lot movements and direct payment edits', async () => {
    const lot = await db.stockLot.findFirstOrThrow({
      where: { organizationId: org, sourceLine: { documentId: receiptId } },
    })
    const target = (
      await service.createWarehouse({
        idempotencyKey: key(),
        code: 'DATE-CHECK',
        name: 'Date check',
      })
    ).id
    const ops = createStockOperations(db, ctx)
    const payload = {
      idempotencyKey: key(),
      lotId: lot.id,
      sourceWarehouseId: warehouseId,
      targetWarehouseId: target,
      quantity: '1',
      effectiveAt: '2026-10-19',
    }
    await expect(ops.transfer(payload)).rejects.toThrow('Дата операції')
    await expect(
      ops.transfer({
        ...payload,
        idempotencyKey: key(),
        quantity: '0.5',
        effectiveAt: '2026-10-22',
      })
    ).rejects.toThrow('цілої')
    const payment = await db.moneyTransaction.findFirstOrThrow({ where: { organizationId: org } })
    await expect(
      db.$executeRaw`UPDATE money_transactions SET amount=amount+1 WHERE id=${payment.id}`
    ).rejects.toThrow('immutable')
  })
  it('posts 100 receipt lines atomically with exact total', async () => {
    const draft = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-22',
      externalDate: '2026-10-22',
      dueDate: '2026-10-30',
      externalNumber: 'BULK-100',
      lines: Array.from({ length: 100 }, () => ({
        inventoryPartId: productId,
        quantity: '1',
        unitPrice: '0.01',
      })),
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    expect(
      await db.stockLot.count({
        where: { organizationId: org, sourceLine: { documentId: draft.id } },
      })
    ).toBe(100)
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { organizationId: org, inventoryDocumentId: draft.id },
    })
    expect(entry.amount.toFixed(2)).toBe('1.00')
  })
})
