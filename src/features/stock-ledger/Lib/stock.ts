import { assertLotDate } from './chronology'
import { nextDocumentNumber } from './numbers'
import { D, fifo } from './amounts'
import {
  demandSchema,
  reserveSchema,
  releaseSchema,
  returnSchema,
  transferSchema,
} from './contracts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerDB,
  type LedgerContext,
  type Tx,
} from './transaction'

async function netIssued(tx: Tx, ctx: LedgerContext, demandId: string) {
  const rows = await tx.documentLotAllocation.findMany({
    where: { organizationId: ctx.organizationId, demandId },
    include: { documentLine: { include: { document: true } } },
  })
  return rows.reduce(
    (sum, r) => sum.plus(r.quantity.mul(r.documentLine.document.kind === 'ISSUE' ? 1 : -1)),
    D(0)
  )
}
async function document(
  tx: Tx,
  ctx: LedgerContext,
  kind: string,
  date: Date,
  sourceWarehouseId?: string,
  targetWarehouseId?: string,
  note?: string
) {
  return tx.inventoryDocument.create({
    data: {
      ...metadata(ctx),
      number: await nextDocumentNumber(tx, ctx, kind, date),
      kind,
      effectiveAt: date,
      sourceWarehouseId,
      targetWarehouseId,
      note,
    },
  })
}
async function lineFor(
  tx: Tx,
  ctx: LedgerContext,
  documentId: string,
  partId: string,
  quantity: string,
  cost: string
) {
  const p = await tx.inventoryPart.findFirstOrThrow({
    where: { id: partId, organizationId: ctx.organizationId },
    include: { brand: true },
  })
  return tx.inventoryDocumentLine.create({
    data: {
      ...metadata(ctx),
      documentId,
      inventoryPartId: p.id,
      quantity,
      unitPrice: cost,
      discountAmount: '0',
      netAmount: '0',
      taxAmount: '0',
      totalAmount: '0',
      snapshotName: p.name,
      snapshotBrand: p.brand.name,
      snapshotArticle: p.partNumber,
      snapshotUnit: p.unit ?? 'pcs',
      sortOrder: 0,
    },
  })
}
async function post(tx: Tx, id: string) {
  await tx.inventoryDocument.update({
    where: { id },
    data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
  })
}
export function createStockOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async createDemand(raw: unknown) {
      const input = demandSchema.parse(raw)
      return ledgerCommand(db, ctx, 'demand.create', input, async (tx) => {
        const part = await tx.servicePart.findFirst({
          where: { id: input.servicePartId, serviceRecord: org },
          include: { serviceRecord: true },
        })
        if (!part || !part.inventoryPartId)
          throw new Error('Виберіть складський товар у позиції наряду')
        if (part.serviceRecord.inventoryAccountingMode !== 'LEDGER')
          throw new Error('Історичний наряд потребує окремої звірки перед переходом на новий склад')
        const old = await tx.stockDemand.findUnique({
          where: { organizationId_servicePartId: { ...org, servicePartId: part.id } },
        })
        if (old) return { id: old.id }
        const demand = await tx.stockDemand.create({
          data: {
            ...meta,
            servicePartId: part.id,
            serviceRecordId: part.serviceRecordId,
            inventoryPartId: part.inventoryPartId,
            requiredQty: D(String(part.quantity)),
          },
        })
        return { id: demand.id }
      })
    },
    async reserve(raw: unknown) {
      const input = reserveSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.reserve', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const demand = await tx.stockDemand.findFirst({
          where: { ...org, id: input.demandId, state: 'ACTIVE', ownership: 'OWN' },
        })
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: input.warehouseId, archivedAt: null, reservable: true },
        })
        if (!demand || !warehouse) throw new Error('Потреба або доступний склад не знайдені')
        const reservations = await tx.stockReservation.aggregate({
          where: { ...org, demandId: demand.id },
          _sum: { remainingQuantity: true },
        })
        const outstanding = demand.requiredQty
          .minus(await netIssued(tx, ctx, demand.id))
          .minus(reservations._sum.remainingQuantity ?? 0)
        if (D(input.quantity).gt(outstanding))
          throw new Error('Резерв перевищує незабезпечену потребу')
        const balances = await tx.stockLotBalance.findMany({
          where: {
            ...org,
            warehouseId: warehouse.id,
            lot: { inventoryPartId: demand.inventoryPartId },
          },
          include: { lot: true },
          orderBy: [{ lot: { acquiredAt: 'asc' } }, { lot: { createdAt: 'asc' } }, { id: 'asc' }],
        })
        const allocations = fifo(
          input.quantity,
          balances.map((b) => ({
            id: b.lotId,
            available: b.onHandQty.minus(b.reservedQty).toString(),
            unitCost: b.lot.unitCost.toString(),
          }))
        )
        const ids = []
        for (const a of allocations) {
          await assertLotDate(tx, ctx, a.lotId, input.effectiveAt, a.quantity)
          const b = balances.find((b) => b.lotId === a.lotId)!
          const r = await tx.stockReservation.create({
            data: {
              ...meta,
              demandId: demand.id,
              lotId: a.lotId,
              warehouseId: warehouse.id,
              createdQuantity: a.quantity,
              remainingQuantity: a.quantity,
            },
          })
          await tx.stockLotBalance.update({
            where: { id: b.id },
            data: { reservedQty: { increment: a.quantity }, version: { increment: 1 } },
          })
          await tx.reservationEvent.create({
            data: {
              ...meta,
              reservationId: r.id,
              kind: 'RESERVE',
              quantity: a.quantity,
              effectiveAt: input.effectiveAt,
              operationKey: input.idempotencyKey + ':' + r.id,
            },
          })
          ids.push(r.id)
        }
        return { id: demand.id, reservationIds: ids, quantity: input.quantity }
      })
    },
    async release(raw: unknown) {
      const input = releaseSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.release', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const r = await tx.stockReservation.findFirst({
          where: { ...org, id: input.reservationId },
        })
        if (!r) throw new Error('Резерв не знайдений')
        await assertLotDate(tx, ctx, r.lotId, input.effectiveAt, input.quantity)
        if (D(input.quantity).gt(r.remainingQuantity)) throw new Error('Кількість перевищує резерв')
        await tx.stockReservation.update({
          where: { id: r.id },
          data: { remainingQuantity: { decrement: input.quantity }, version: { increment: 1 } },
        })
        await tx.stockLotBalance.update({
          where: {
            organizationId_lotId_warehouseId: {
              ...org,
              lotId: r.lotId,
              warehouseId: r.warehouseId,
            },
          },
          data: { reservedQty: { decrement: input.quantity }, version: { increment: 1 } },
        })
        await tx.reservationEvent.create({
          data: {
            ...meta,
            reservationId: r.id,
            kind: 'RELEASE',
            quantity: input.quantity,
            effectiveAt: input.effectiveAt,
            operationKey: input.idempotencyKey,
          },
        })
        return { id: r.id, quantity: input.quantity }
      })
    },
    async issue(raw: unknown) {
      const input = reserveSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.issue', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const demand = await tx.stockDemand.findFirst({
          where: { ...org, id: input.demandId, state: 'ACTIVE', ownership: 'OWN' },
        })
        if (!demand) throw new Error('Потреба не знайдена')
        if (D(input.quantity).gt(demand.requiredQty.minus(await netIssued(tx, ctx, demand.id))))
          throw new Error('Видача перевищує потребу')
        const reservations = await tx.stockReservation.findMany({
          where: {
            ...org,
            demandId: demand.id,
            warehouseId: input.warehouseId,
            remainingQuantity: { gt: 0 },
          },
          include: { lot: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        if (D(input.quantity).gt(reservations.reduce((s, r) => s.plus(r.remainingQuantity), D(0))))
          throw new Error('Спочатку зарезервуйте потрібну кількість на цьому складі')
        const doc = await document(tx, ctx, 'ISSUE', input.effectiveAt, input.warehouseId)
        const line = await lineFor(tx, ctx, doc.id, demand.inventoryPartId, input.quantity, '0')
        let remaining = D(input.quantity),
          cost = D(0)
        for (const r of reservations) {
          if (remaining.isZero()) break
          await assertLotDate(tx, ctx, r.lotId, input.effectiveAt, input.quantity)
          const q = D(r.remainingQuantity).lt(remaining) ? r.remainingQuantity : remaining
          const amount = q.mul(r.lot.unitCost)
          await tx.stockReservation.update({
            where: { id: r.id },
            data: { remainingQuantity: { decrement: q }, version: { increment: 1 } },
          })
          await tx.stockLotBalance.update({
            where: {
              organizationId_lotId_warehouseId: {
                ...org,
                lotId: r.lotId,
                warehouseId: r.warehouseId,
              },
            },
            data: {
              onHandQty: { decrement: q },
              reservedQty: { decrement: q },
              version: { increment: 1 },
            },
          })
          await tx.documentLotAllocation.create({
            data: {
              ...meta,
              documentLineId: line.id,
              lotId: r.lotId,
              warehouseId: r.warehouseId,
              demandId: demand.id,
              quantity: q,
              unitCostSnapshot: r.lot.unitCost,
            },
          })
          await tx.reservationEvent.create({
            data: {
              ...meta,
              reservationId: r.id,
              documentLineId: line.id,
              kind: 'CONSUME',
              quantity: q,
              effectiveAt: input.effectiveAt,
              operationKey: input.idempotencyKey + ':' + r.id,
            },
          })
          await tx.inventoryLedgerEntry.create({
            data: {
              ...meta,
              documentLineId: line.id,
              lotId: r.lotId,
              warehouseId: r.warehouseId,
              quantityDelta: q.negated(),
              costAmountDelta: amount.negated(),
              effectiveAt: input.effectiveAt,
              operationKey: input.idempotencyKey + ':' + r.id,
            },
          })
          remaining = remaining.minus(q)
          cost = cost.plus(amount)
        }
        await post(tx, doc.id)
        return { id: doc.id, cost: cost.toFixed(6), quantity: input.quantity }
      })
    },
    async returnFromWorkOrder(raw: unknown) {
      const input = returnSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.return', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        const source = await tx.documentLotAllocation.findFirst({
          where: { ...org, id: input.allocationId },
          include: { lot: true, documentLine: { include: { document: true } } },
        })
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        if (!source || !warehouse || source.documentLine.document.kind !== 'ISSUE')
          throw new Error('Вихідна видача або склад не знайдені')
        await assertLotDate(tx, ctx, source.lotId, input.effectiveAt, input.quantity)
        if (input.effectiveAt < source.documentLine.document.effectiveAt)
          throw new Error('Дата повернення передує видачі')
        const returned = await tx.documentLotAllocation.aggregate({
          where: { ...org, sourceIssueAllocationId: source.id },
          _sum: { quantity: true },
        })
        if (D(input.quantity).gt(source.quantity.minus(returned._sum.quantity ?? 0)))
          throw new Error('Повернення перевищує видану кількість')
        const doc = await document(
          tx,
          ctx,
          'WORK_ORDER_RETURN',
          input.effectiveAt,
          undefined,
          warehouse.id,
          input.reason
        )
        const line = await lineFor(
          tx,
          ctx,
          doc.id,
          source.lot.inventoryPartId,
          input.quantity,
          source.unitCostSnapshot.toString()
        )
        await tx.stockLotBalance.upsert({
          where: {
            organizationId_lotId_warehouseId: {
              ...org,
              lotId: source.lotId,
              warehouseId: warehouse.id,
            },
          },
          create: {
            ...meta,
            lotId: source.lotId,
            warehouseId: warehouse.id,
            onHandQty: input.quantity,
          },
          update: { onHandQty: { increment: input.quantity }, version: { increment: 1 } },
        })
        await tx.documentLotAllocation.create({
          data: {
            ...meta,
            documentLineId: line.id,
            lotId: source.lotId,
            warehouseId: warehouse.id,
            demandId: source.demandId,
            quantity: input.quantity,
            unitCostSnapshot: source.unitCostSnapshot,
            sourceIssueAllocationId: source.id,
          },
        })
        await tx.inventoryLedgerEntry.create({
          data: {
            ...meta,
            documentLineId: line.id,
            lotId: source.lotId,
            warehouseId: warehouse.id,
            quantityDelta: input.quantity,
            costAmountDelta: D(input.quantity).mul(source.unitCostSnapshot),
            effectiveAt: input.effectiveAt,
            operationKey: input.idempotencyKey,
          },
        })
        await post(tx, doc.id)
        return { id: doc.id, quantity: input.quantity }
      })
    },
    async transfer(raw: unknown) {
      const input = transferSchema.parse(raw)
      return ledgerCommand(db, ctx, 'stock.transfer', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, true)
        if (input.sourceWarehouseId === input.targetWarehouseId)
          throw new Error('Виберіть різні склади')
        const balance = await tx.stockLotBalance.findFirst({
          where: { ...org, lotId: input.lotId, warehouseId: input.sourceWarehouseId },
          include: { lot: true },
        })
        const target = await tx.warehouse.findFirst({
          where: { ...org, id: input.targetWarehouseId, archivedAt: null },
        })
        if (!balance || !target) throw new Error('Партія або склад не знайдені')
        await assertLotDate(tx, ctx, balance.lotId, input.effectiveAt, input.quantity)
        if (D(input.quantity).gt(balance.onHandQty.minus(balance.reservedQty)))
          throw new Error('Недостатньо вільного залишку для переміщення')
        const doc = await document(
          tx,
          ctx,
          'TRANSFER',
          input.effectiveAt,
          input.sourceWarehouseId,
          target.id
        )
        const line = await lineFor(
          tx,
          ctx,
          doc.id,
          balance.lot.inventoryPartId,
          input.quantity,
          balance.lot.unitCost.toString()
        )
        await tx.stockLotBalance.update({
          where: { id: balance.id },
          data: { onHandQty: { decrement: input.quantity }, version: { increment: 1 } },
        })
        await tx.stockLotBalance.upsert({
          where: {
            organizationId_lotId_warehouseId: {
              ...org,
              lotId: balance.lotId,
              warehouseId: target.id,
            },
          },
          create: {
            ...meta,
            lotId: balance.lotId,
            warehouseId: target.id,
            onHandQty: input.quantity,
          },
          update: { onHandQty: { increment: input.quantity }, version: { increment: 1 } },
        })
        for (const [warehouseId, sign] of [
          [balance.warehouseId, -1],
          [target.id, 1],
        ] as const)
          await tx.inventoryLedgerEntry.create({
            data: {
              ...meta,
              documentLineId: line.id,
              lotId: balance.lotId,
              warehouseId,
              quantityDelta: D(input.quantity).mul(sign),
              costAmountDelta: D(input.quantity).mul(balance.lot.unitCost).mul(sign),
              effectiveAt: input.effectiveAt,
              operationKey: input.idempotencyKey + ':' + warehouseId,
            },
          })
        await post(tx, doc.id)
        return { id: doc.id, quantity: input.quantity }
      })
    },
  }
}
