import { reversalSchema } from './contracts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerContext,
  type LedgerDB,
} from './transaction'
import { assertLotDate } from './chronology'
import { nextDocumentNumber } from './numbers'
import { unallocate } from './settlements'
import { refreshPurchaseOrders } from './procurement'

export function reverseReceipt(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = reversalSchema.parse(raw),
    org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return ledgerCommand(db, ctx, 'receipt.reverse', input, async (tx) => {
    await assertPeriod(tx, ctx, input.effectiveAt, true)
    const source = await tx.inventoryDocument.findFirst({
      where: { ...org, id: input.id, kind: 'RECEIPT', status: 'POSTED' },
      include: {
        inventoryDocumentLine_document: {
          include: { receiptDemandAllocation_receiptLine: true, purchaseOrderLine: true },
        },
      },
    })
    if (!source) throw new Error('Проведений прихід не знайдений або вже сторнований')
    if (input.effectiveAt < source.effectiveAt) throw new Error('Сторно не може передувати приходу')
    const lots = await tx.stockLot.findMany({
      where: { ...org, sourceLine: { documentId: source.id } },
      include: { stockLotBalance_lot: true },
    })
    for (const lot of lots) {
      await assertLotDate(tx, ctx, lot.id, input.effectiveAt)
      const dependent = await tx.inventoryLedgerEntry.count({
        where: { ...org, lotId: lot.id, documentLine: { documentId: { not: source.id } } },
      })
      if (dependent || lot.stockLotBalance_lot.some((b) => b.reservedQty.gt(0)))
        throw new Error('Партія має залежні рухи або резерви. Повне сторно приходу заборонено.')
    }
    const doc = await tx.inventoryDocument.create({
      data: {
        ...meta,
        number: await nextDocumentNumber(tx, ctx, 'RV', input.effectiveAt),
        kind: 'REVERSAL',
        sourceDocumentId: source.id,
        supplierId: source.supplierId,
        sourceWarehouseId: source.targetWarehouseId,
        effectiveAt: input.effectiveAt,
        note: input.reason,
        subtotal: source.subtotal,
        additionalCost: source.additionalCost,
        roundingAdjustment: source.roundingAdjustment,
        roundingReason: source.roundingReason,
        costAllocationMethod: source.costAllocationMethod,
        sourceTotal: source.sourceTotal,
        taxAmount: source.taxAmount,
        totalAmount: source.totalAmount,
      },
    })
    const orders = new Set<string>()
    for (const original of source.inventoryDocumentLine_document) {
      const lot = lots.find((l) => l.sourceLineId === original.id)
      if (!lot) throw new Error('Партія приходу не знайдена: потрібна звірка')
      const balance = lot.stockLotBalance_lot.find(
        (b) => b.warehouseId === source.targetWarehouseId
      )
      if (!balance || !balance.onHandQty.eq(original.quantity))
        throw new Error('Залишок партії відрізняється від приходу')
      const {
        id,
        createdAt,
        createdById,
        organizationId,
        documentId,
        receiptDemandAllocation_receiptLine,
        purchaseOrderLine,
        purchaseOrderLineId,
        ...snapshot
      } = original
      const line = await tx.inventoryDocumentLine.create({
        data: { ...meta, ...snapshot, documentId: doc.id },
      })
      await tx.stockLotBalance.update({
        where: { id: balance.id },
        data: { onHandQty: 0, version: { increment: 1 } },
      })
      const movement = await tx.inventoryLedgerEntry.findFirstOrThrow({
        where: { ...org, lotId: lot.id, documentLineId: original.id },
      })
      await tx.inventoryLedgerEntry.create({
        data: {
          ...meta,
          lotId: lot.id,
          warehouseId: balance.warehouseId,
          documentLineId: line.id,
          quantityDelta: movement.quantityDelta.negated(),
          costAmountDelta: movement.costAmountDelta.negated(),
          effectiveAt: input.effectiveAt,
          operationKey: doc.id + ':' + line.id,
        },
      })
      for (const a of receiptDemandAllocation_receiptLine)
        if (a.purchaseAllocationId)
          await tx.purchaseDemandAllocation.update({
            where: { id: a.purchaseAllocationId },
            data: { fulfilledQty: { decrement: a.quantity } },
          })
      if (purchaseOrderLine) orders.add(purchaseOrderLine.orderId)
    }
    const debit = await tx.settlementEntry.findFirst({
      where: { ...org, inventoryDocumentId: source.id, polarity: 'DEBIT' },
      include: { settlementAllocation_debitEntry: { where: { reversedAt: null } } },
    })
    if (debit) {
      for (const a of debit.settlementAllocation_debitEntry)
        await unallocate(tx, ctx, a.id, input.effectiveAt, input.reason)
      const credit = await tx.settlementEntry.create({
        data: {
          ...meta,
          partyId: debit.partyId,
          side: 'AP',
          polarity: 'CREDIT',
          amount: debit.amount,
          effectiveAt: input.effectiveAt,
          inventoryDocumentId: doc.id,
          reversalOfId: debit.id,
          operationKey: 'reverse:' + doc.id,
        },
      })
      await tx.settlementAllocation.create({
        data: {
          ...meta,
          debitEntryId: debit.id,
          creditEntryId: credit.id,
          operationKey: 'offset:' + doc.id,
          amount: debit.amount,
          effectiveAt: input.effectiveAt,
        },
      })
    }
    await tx.inventoryDocument.update({
      where: { id: doc.id },
      data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
    })
    await tx.inventoryDocument.update({
      where: { id: source.id },
      data: { status: 'REVERSED', version: { increment: 1 } },
    })
    await refreshPurchaseOrders(tx, ctx, orders)
    return { id: doc.id, sourceId: source.id, status: 'POSTED' }
  })
}
