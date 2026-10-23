import { assertLotDate } from './chronology'
import { nextDocumentNumber } from './numbers'
import { outgoingCost } from './valuation'
import { proportionalAmount, D } from './amounts'
import { supplierReturnSchema } from './contracts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerDB,
  type LedgerContext,
} from './transaction'
export function returnToSupplier(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = supplierReturnSchema.parse(raw),
    org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return ledgerCommand(db, ctx, 'supplier.return', input, async (tx) => {
    await assertPeriod(tx, ctx, input.effectiveAt, true)
    const balance = await tx.stockLotBalance.findFirst({
      where: { ...org, lotId: input.lotId, warehouseId: input.warehouseId },
      include: { lot: { include: { sourceLine: { include: { document: true } } } } },
    })
    if (!balance) throw new Error('Партія не знайдена')
    await assertLotDate(tx, ctx, balance.lotId, input.effectiveAt, input.quantity)
    const source = balance.lot.sourceLine,
      receipt = source.document
    if (receipt.kind !== 'RECEIPT' || !receipt.supplierId || receipt.status !== 'POSTED')
      throw new Error('Партія не має проведеного приходу постачальника')
    if (input.effectiveAt < receipt.effectiveAt)
      throw new Error('Повернення не може передувати приходу')
    if (D(input.quantity).gt(balance.onHandQty.minus(balance.reservedQty)))
      throw new Error('Недостатньо вільного залишку для повернення')
    const previous = await tx.inventoryDocumentLine.findMany({
      where: {
        ...org,
        inventoryPartId: source.inventoryPartId,
        document: { sourceDocumentId: receipt.id, kind: 'SUPPLIER_RETURN', status: 'POSTED' },
      },
      include: { inventoryLedgerEntry_documentLine: { where: { lotId: input.lotId } } },
    })
    const returned = previous.filter((l) => l.inventoryLedgerEntry_documentLine.length > 0)
    const returnedQty = returned.reduce((s, l) => s.plus(l.quantity), D(0))
    if (returnedQty.plus(input.quantity).gt(source.quantity))
      throw new Error('Повернення перевищує кількість приходу')
    const net = proportionalAmount(
      source.netAmount.toString(),
      source.quantity.toString(),
      returned.reduce((s, l) => s.plus(l.netAmount), D(0)).toString(),
      returnedQty.toString(),
      input.quantity,
      2
    )
    const tax = proportionalAmount(
      source.taxAmount.toString(),
      source.quantity.toString(),
      returned.reduce((s, l) => s.plus(l.taxAmount), D(0)).toString(),
      returnedQty.toString(),
      input.quantity,
      2
    )
    const stockCost = await outgoingCost(
      tx,
      ctx,
      balance.lotId,
      balance.warehouseId,
      input.quantity
    )
    const doc = await tx.inventoryDocument.create({
      data: {
        ...meta,
        number: await nextDocumentNumber(tx, ctx, 'SR', input.effectiveAt),
        kind: 'SUPPLIER_RETURN',
        supplierId: receipt.supplierId,
        sourceWarehouseId: input.warehouseId,
        sourceDocumentId: receipt.id,
        effectiveAt: input.effectiveAt,
        note: input.reason,
        subtotal: net,
        taxAmount: tax,
        totalAmount: net.plus(tax),
      },
    })
    const line = await tx.inventoryDocumentLine.create({
      data: {
        ...meta,
        documentId: doc.id,
        inventoryPartId: source.inventoryPartId,
        quantity: input.quantity,
        unitPrice: source.unitPrice,
        discountAmount: 0,
        netAmount: net,
        taxAmount: tax,
        totalAmount: net.plus(tax),
        snapshotName: source.snapshotName,
        snapshotBrand: source.snapshotBrand,
        snapshotArticle: source.snapshotArticle,
        snapshotUnit: source.snapshotUnit,
        sortOrder: 0,
      },
    })
    await tx.stockLotBalance.update({
      where: { id: balance.id },
      data: { onHandQty: { decrement: input.quantity }, version: { increment: 1 } },
    })
    await tx.inventoryLedgerEntry.create({
      data: {
        ...meta,
        documentLineId: line.id,
        lotId: balance.lotId,
        warehouseId: balance.warehouseId,
        quantityDelta: D(input.quantity).negated(),
        costAmountDelta: stockCost.negated(),
        effectiveAt: input.effectiveAt,
        operationKey: input.idempotencyKey,
      },
    })
    const party = await tx.settlementParty.findUniqueOrThrow({
      where: { organizationId_supplierId: { ...org, supplierId: receipt.supplierId } },
    })
    if (net.plus(tax).gt(0))
      await tx.settlementEntry.create({
        data: {
          ...meta,
          partyId: party.id,
          side: 'AP',
          polarity: 'CREDIT',
          amount: net.plus(tax),
          effectiveAt: input.effectiveAt,
          inventoryDocumentId: doc.id,
          operationKey: 'return:' + doc.id,
        },
      })
    await tx.inventoryDocument.update({
      where: { id: doc.id },
      data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
    })
    return { id: doc.id, credit: net.plus(tax).toFixed(2), quantity: input.quantity }
  })
}
