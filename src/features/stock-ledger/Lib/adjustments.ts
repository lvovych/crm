import { assertLotDate } from './chronology'
import { nextDocumentNumber } from './numbers'
import { openingStockSchema, adjustmentSchema } from './contracts'
import { outgoingCost } from './valuation'
import { D, cents } from './amounts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerDB,
  type LedgerContext,
} from './transaction'
export function createStockAdjustments(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async opening(raw: unknown) {
      const input = openingStockSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.opening', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        if (!warehouse) throw new Error('Склад не знайдений')
        const doc = await tx.inventoryDocument.create({
          data: {
            ...meta,
            number: await nextDocumentNumber(tx, ctx, 'OPEN', input.effectiveAt),
            kind: 'OPENING',
            effectiveAt: input.effectiveAt,
            targetWarehouseId: warehouse.id,
            note: input.reason,
          },
        })
        for (const [index, inputLine] of input.lines.entries()) {
          const product = await tx.inventoryPart.findFirst({
            where: { ...org, id: inputLine.inventoryPartId, isArchived: false },
            include: { brand: true },
          })
          if (!product) throw new Error('Товар не знайдений')
          if (
            ['pcs', 'шт', 'шт.'].includes(product.unit ?? 'pcs') &&
            !D(inputLine.quantity).isInteger()
          )
            throw new Error('Кількість штучного товару має бути цілою')
          if (
            await tx.stockLotBalance.count({
              where: { ...org, warehouseId: warehouse.id, lot: { inventoryPartId: product.id } },
            })
          )
            throw new Error(
              'Для товару вже є історія на складі. Використайте інвентаризаційне коригування'
            )
          const total = cents(D(inputLine.quantity).mul(inputLine.unitPrice))
          const line = await tx.inventoryDocumentLine.create({
            data: {
              ...meta,
              documentId: doc.id,
              inventoryPartId: product.id,
              quantity: inputLine.quantity,
              unitPrice: inputLine.unitPrice,
              discountAmount: 0,
              netAmount: total,
              taxAmount: 0,
              totalAmount: total,
              snapshotName: product.name,
              snapshotBrand: product.brand.name,
              snapshotArticle: product.partNumber,
              snapshotUnit: product.unit ?? 'pcs',
              sortOrder: index,
            },
          })
          const lot = await tx.stockLot.create({
            data: {
              ...meta,
              inventoryPartId: product.id,
              sourceLineId: line.id,
              acquiredAt: input.effectiveAt,
              unitCost: total.div(inputLine.quantity).toDecimalPlaces(6),
            },
          })
          await tx.stockLotBalance.create({
            data: {
              ...meta,
              lotId: lot.id,
              warehouseId: warehouse.id,
              onHandQty: inputLine.quantity,
            },
          })
          await tx.inventoryLedgerEntry.create({
            data: {
              ...meta,
              documentLineId: line.id,
              lotId: lot.id,
              warehouseId: warehouse.id,
              quantityDelta: inputLine.quantity,
              costAmountDelta: total,
              effectiveAt: input.effectiveAt,
              operationKey: 'opening:' + line.id,
            },
          })
        }
        const totals = await tx.inventoryDocumentLine.aggregate({
          where: { documentId: doc.id },
          _sum: { totalAmount: true },
        })
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: {
            subtotal: totals._sum.totalAmount ?? 0,
            totalAmount: totals._sum.totalAmount ?? 0,
            status: 'POSTED',
            postedAt: new Date(),
            version: { increment: 1 },
          },
        })
        return { id: doc.id, status: 'POSTED' }
      })
    },
    async adjust(raw: unknown) {
      const input = adjustmentSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.adjust', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const balance = await tx.stockLotBalance.findFirst({
          where: { ...org, id: input.balanceId },
          include: { lot: { include: { inventoryPart: { include: { brand: true } } } } },
        })
        if (!balance) throw new Error('Партія не знайдена')
        await assertLotDate(tx, ctx, balance.lotId, input.effectiveAt)
        if (balance.version !== input.expectedVersion)
          throw new Error('Після підрахунку були рухи. Повторіть звірку залишку')
        const counted = D(input.countedQuantity)
        if (counted.decimalPlaces() > 3)
          throw new Error('Кількість має не більше трьох знаків після крапки')
        if (counted.lt(balance.reservedQty)) throw new Error('Спочатку звільніть резерв')
        const difference = counted.minus(balance.onHandQty)
        if (difference.isZero()) throw new Error('Залишок збігається, коригування не потрібне')
        const product = balance.lot.inventoryPart
        if (['pcs', 'шт', 'шт.'].includes(product.unit ?? 'pcs') && !counted.isInteger())
          throw new Error('Кількість штучного товару має бути цілою')
        const costDelta = difference.lt(0)
          ? (
              await outgoingCost(
                tx,
                ctx,
                balance.lotId,
                balance.warehouseId,
                difference.abs().toString()
              )
            ).negated()
          : difference.mul(balance.lot.unitCost).toDecimalPlaces(6)
        const doc = await tx.inventoryDocument.create({
          data: {
            ...meta,
            number: await nextDocumentNumber(tx, ctx, 'ADJ', input.effectiveAt),
            kind: 'ADJUSTMENT',
            effectiveAt: input.effectiveAt,
            sourceWarehouseId: difference.lt(0) ? balance.warehouseId : null,
            targetWarehouseId: difference.gt(0) ? balance.warehouseId : null,
            note: input.reason,
          },
        })
        const line = await tx.inventoryDocumentLine.create({
          data: {
            ...meta,
            documentId: doc.id,
            inventoryPartId: product.id,
            quantity: difference.abs(),
            unitPrice: balance.lot.unitCost,
            discountAmount: 0,
            netAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            snapshotName: product.name,
            snapshotBrand: product.brand.name,
            snapshotArticle: product.partNumber,
            snapshotUnit: product.unit ?? 'pcs',
            sortOrder: 0,
          },
        })
        await tx.stockLotBalance.update({
          where: { id: balance.id },
          data: { onHandQty: counted, version: { increment: 1 } },
        })
        await tx.inventoryLedgerEntry.create({
          data: {
            ...meta,
            documentLineId: line.id,
            lotId: balance.lotId,
            warehouseId: balance.warehouseId,
            quantityDelta: difference,
            costAmountDelta: costDelta,
            effectiveAt: input.effectiveAt,
            operationKey: input.idempotencyKey,
          },
        })
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
        })
        return { id: doc.id, delta: difference.toFixed(3), reason: input.reason }
      })
    },
  }
}
