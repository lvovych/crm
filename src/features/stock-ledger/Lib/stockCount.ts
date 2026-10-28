import { assertProductQuantity } from './catalogs'
import { z } from 'zod'
import { commandSchema, dateText, postSchema } from './contracts'
import { D, cents, decimalText } from './amounts'
import {
  ledgerCommand,
  metadata,
  assertPeriod,
  type LedgerDB,
  type LedgerContext,
} from './transaction'
import { assertLotDate } from './chronology'
import { outgoingCost } from './valuation'
import { nextDocumentNumber } from './numbers'
export function stockCountOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async start(raw: unknown) {
      const input = commandSchema
        .extend({
          warehouseId: z.string().min(1),
          effectiveAt: dateText,
          reason: z.string().trim().min(5).max(2000),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'count.start', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        await tx.warehouse.findFirstOrThrow({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        const balances = await tx.stockLotBalance.findMany({
          where: { ...org, warehouseId: input.warehouseId },
          include: { lot: true },
          orderBy: { id: 'asc' },
        })
        const count = await tx.ledgerStockCount.create({
          data: {
            ...meta,
            warehouseId: input.warehouseId,
            effectiveAt: input.effectiveAt,
            reason: input.reason,
          },
        })
        if (balances.length)
          await tx.ledgerStockCountLine.createMany({
            data: balances.map((b) => ({
              ...org,
              countId: count.id,
              inventoryPartId: b.lot.inventoryPartId,
              lotId: b.lotId,
              expectedQty: b.onHandQty,
              snapshotVersion: b.version,
            })),
          })
        return { id: count.id, version: 1 }
      })
    },
    async save(raw: unknown) {
      const input = postSchema
        .extend({
          lines: z
            .array(
              z.object({
                id: z.string().optional(),
                inventoryPartId: z.string(),
                countedQty: decimalText,
                confirmedUnitCost: decimalText.optional(),
                reason: z.string().trim().max(1000).default(''),
              })
            )
            .max(10000),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'count.save', input, async (tx) => {
        const count = await tx.ledgerStockCount.findFirst({
          where: {
            ...org,
            id: input.documentId,
            version: input.expectedVersion,
            status: 'COUNTING',
          },
          include: { lines: true },
        })
        if (!count) throw new Error('Інвентаризацію змінено. Оновіть документ.')
        const ids = new Set<string>()
        for (const line of input.lines) {
          if (D(line.countedQty).decimalPlaces() > 3)
            throw new Error('Кількість має не більше 3 знаків після крапки')
          const product = await tx.inventoryPart.findFirstOrThrow({
            where: { ...org, id: line.inventoryPartId },
          })
          await assertProductQuantity(tx, ctx, product, line.countedQty, !!line.id)
          if (line.id) {
            const previous = count.lines.find(
              (l) => l.id === line.id && l.inventoryPartId === line.inventoryPartId
            )
            if (!previous || ids.has(line.id))
              throw new Error('Некоректна або повторна позиція інвентаризації')
            ids.add(line.id)
            if (!D(line.countedQty).eq(previous.expectedQty) && line.reason.length < 5)
              throw new Error('Вкажіть причину розбіжності для кожної зміненої позиції')
            await tx.ledgerStockCountLine.update({
              where: { id: line.id },
              data: { countedQty: line.countedQty, reason: line.reason },
            })
          } else {
            if (
              !D(line.countedQty).gt(0) ||
              line.confirmedUnitCost === undefined ||
              line.reason.length < 5
            )
              throw new Error(
                'Для надлишку вкажіть додатну кількість, підтверджену собівартість і причину'
              )
            await tx.ledgerStockCountLine.create({
              data: {
                ...org,
                countId: count.id,
                inventoryPartId: line.inventoryPartId,
                expectedQty: 0,
                countedQty: line.countedQty,
                confirmedUnitCost: line.confirmedUnitCost,
                reason: line.reason,
              },
            })
          }
        }
        await tx.ledgerStockCount.update({
          where: { id: count.id },
          data: { version: { increment: 1 } },
        })
        return { id: count.id, version: count.version + 1 }
      })
    },
    async cancel(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'count.cancel', input, async (tx) => {
        const row = await tx.ledgerStockCount.updateMany({
          where: {
            ...org,
            id: input.documentId,
            version: input.expectedVersion,
            status: 'COUNTING',
          },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        })
        if (!row.count) throw new Error('Документ уже змінено')
        return { id: input.documentId, status: 'CANCELLED' }
      })
    },
    async post(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'count.post', input, async (tx) => {
        const count = await tx.ledgerStockCount.findFirst({
          where: {
            ...org,
            id: input.documentId,
            version: input.expectedVersion,
            status: 'COUNTING',
          },
          include: {
            lines: { include: { inventoryPart: { include: { brand: true } }, lot: true } },
          },
        })
        if (!count) throw new Error('Інвентаризацію вже змінено або проведено')
        await assertPeriod(tx, ctx, count.effectiveAt, true)
        if (!count.lines.length || count.lines.some((l) => l.countedQty === null))
          throw new Error('Порахуйте всі позиції перед проведенням')
        // New lots after the snapshot must not disappear from the count.
        const balances = await tx.stockLotBalance.findMany({
          where: { ...org, warehouseId: count.warehouseId },
        })
        if (balances.some((b) => !count.lines.some((l) => l.lotId === b.lotId)))
          throw new Error(
            'Після початку на складі з’явилися нові партії. Створіть нову інвентаризацію.'
          )
        const doc = await tx.inventoryDocument.create({
          data: {
            ...meta,
            number: await nextDocumentNumber(tx, ctx, 'COUNT', count.effectiveAt),
            kind: 'ADJUSTMENT',
            targetWarehouseId: count.warehouseId,
            effectiveAt: count.effectiveAt,
            note: count.reason,
          },
        })
        let index = 0
        for (const item of count.lines) {
          const actual = D(item.countedQty!),
            delta = actual.minus(item.expectedQty)
          const balance = item.lotId ? balances.find((b) => b.lotId === item.lotId) : undefined
          if (item.lotId && (!balance || balance.version !== item.snapshotVersion))
            throw new Error(
              'Після зрізу були рухи або резерви. Повторіть підрахунок у новій інвентаризації.'
            )
          if (balance && actual.lt(balance.reservedQty))
            throw new Error('Фактична кількість менша за резерв. Спочатку звільніть резерв.')
          if (delta.isZero()) continue
          if (item.reason.length < 5) throw new Error('Вкажіть причину розбіжності')
          if (item.lotId)
            await assertLotDate(tx, ctx, item.lotId, count.effectiveAt, delta.abs().toString())
          const cost = delta.lt(0)
            ? (
                await outgoingCost(tx, ctx, item.lotId!, count.warehouseId, delta.abs().toString())
              ).negated()
            : item.lot
              ? delta.mul(item.lot.unitCost).toDecimalPlaces(6)
              : cents(delta.mul(item.confirmedUnitCost!))
          const product = item.inventoryPart
          const line = await tx.inventoryDocumentLine.create({
            data: {
              ...meta,
              documentId: doc.id,
              inventoryPartId: product.id,
              quantity: delta.abs(),
              unitPrice: item.lot?.unitCost ?? item.confirmedUnitCost!,
              discountAmount: 0,
              netAmount: 0,
              taxAmount: 0,
              totalAmount: 0,
              snapshotName: product.name,
              snapshotArticle: product.partNumber,
              snapshotBrand: product.brand.name,
              snapshotUnit: product.unit ?? 'pcs',
              sortOrder: index++,
            },
          })
          const lot =
            item.lot ??
            (await tx.stockLot.create({
              data: {
                ...meta,
                sourceLineId: line.id,
                inventoryPartId: product.id,
                acquiredAt: count.effectiveAt,
                unitCost: cost.div(delta).toDecimalPlaces(6),
              },
            }))
          if (balance)
            await tx.stockLotBalance.update({
              where: { id: balance.id },
              data: { onHandQty: actual, version: { increment: 1 } },
            })
          else
            await tx.stockLotBalance.create({
              data: { ...meta, lotId: lot.id, warehouseId: count.warehouseId, onHandQty: actual },
            })
          await tx.inventoryLedgerEntry.create({
            data: {
              ...meta,
              documentLineId: line.id,
              lotId: lot.id,
              warehouseId: count.warehouseId,
              quantityDelta: delta,
              costAmountDelta: cost,
              effectiveAt: count.effectiveAt,
              operationKey: doc.id + ':' + item.id,
            },
          })
        }
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
        })
        await tx.ledgerStockCount.update({
          where: { id: count.id },
          data: { status: 'POSTED', version: { increment: 1 }, adjustmentDocumentId: doc.id },
        })
        return { id: count.id, documentId: doc.id, status: 'POSTED' }
      })
    },
  }
}
