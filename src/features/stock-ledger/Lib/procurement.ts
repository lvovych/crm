import { nextDocumentNumber } from './numbers'
import { purchaseSchema, postSchema, receiptAllocationSchema } from './contracts'
import { D } from './amounts'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext, type Tx } from './transaction'
export function createProcurement(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async saveDraft(raw: unknown) {
      const input = purchaseSchema.parse(raw)
      return ledgerCommand(db, ctx, 'purchase.create', input, async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { ...org, id: input.supplierId, archivedAt: null },
        })
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        if (!supplier || !warehouse) throw new Error('Постачальник або склад не знайдені')
        if (supplier.kind === 'SERVICES') throw new Error('Виберіть постачальника товарів')
        const order = await tx.purchaseOrder.create({
          data: {
            ...meta,
            number: await nextDocumentNumber(tx, ctx, 'PO'),
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            expectedAt: input.expectedAt,
            note: input.note,
          },
        })
        for (const [index, line] of input.lines.entries()) {
          const product = await tx.inventoryPart.findFirst({
            where: { ...org, id: line.inventoryPartId, isArchived: false },
            include: { brand: true },
          })
          if (!product) throw new Error('Товар не знайдений')
          if (['pcs', 'шт', 'шт.'].includes(product.unit ?? 'pcs') && !D(line.quantity).isInteger())
            throw new Error('Штучний товар потребує цілої кількості')
          if (line.allocations.reduce((s, a) => s.plus(a.quantity), D(0)).gt(line.quantity))
            throw new Error('Розподіл перевищує кількість замовлення')
          const saved = await tx.purchaseOrderLine.create({
            data: {
              ...meta,
              orderId: order.id,
              inventoryPartId: product.id,
              qtyOrdered: line.quantity,
              quotedUnitPrice: line.unitPrice,
              snapshotName: product.name,
              snapshotBrand: product.brand.name,
              snapshotArticle: product.partNumber,
              snapshotUnit: product.unit ?? 'pcs',
              sortOrder: index,
            },
          })
          for (const allocation of line.allocations) {
            const demand = await tx.stockDemand.findFirst({
              where: {
                ...org,
                id: allocation.demandId,
                inventoryPartId: product.id,
                state: 'ACTIVE',
                ownership: 'OWN',
              },
            })
            if (!demand) throw new Error('Потреба не відповідає товару')
            await tx.purchaseDemandAllocation.create({
              data: {
                ...meta,
                purchaseOrderLineId: saved.id,
                demandId: demand.id,
                quantity: allocation.quantity,
              },
            })
          }
        }
        return { id: order.id, version: 1, status: 'DRAFT' }
      })
    },
    async confirm(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'purchase.confirm', input, async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
          where: { ...org, id: input.documentId, status: 'DRAFT', version: input.expectedVersion },
        })
        if (!order) throw new Error('Чернетка не знайдена або вже змінена')
        const planned = await tx.purchaseDemandAllocation.findMany({
          where: { ...org, purchaseOrderLine: { orderId: order.id } },
        })
        for (const demandId of new Set(planned.map((a) => a.demandId))) {
          const demand = await tx.stockDemand.findFirstOrThrow({
            where: { ...org, id: demandId, state: 'ACTIVE' },
            include: {
              stockReservation_demand: true,
              documentLotAllocation_demand: {
                include: { documentLine: { include: { document: true } } },
              },
              purchaseDemandAllocation_demand: {
                include: { purchaseOrderLine: { include: { order: true } } },
              },
            },
          })
          const issued = demand.documentLotAllocation_demand.reduce(
            (s, a) => s.plus(a.quantity.mul(a.documentLine.document.kind === 'ISSUE' ? 1 : -1)),
            D(0)
          )
          const reserved = demand.stockReservation_demand.reduce(
            (s, r) => s.plus(r.remainingQuantity),
            D(0)
          )
          const expected = demand.purchaseDemandAllocation_demand
            .filter(
              (a) =>
                a.purchaseOrderLine.orderId !== order.id &&
                ['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(a.purchaseOrderLine.order.status)
            )
            .reduce((s, a) => s.plus(a.quantity.minus(a.fulfilledQty)), D(0))
          const quantity = planned
            .filter((a) => a.demandId === demandId)
            .reduce((s, a) => s.plus(a.quantity), D(0))
          if (quantity.gt(demand.requiredQty.minus(issued).minus(reserved).minus(expected)))
            throw new Error(
              'Для цієї потреби товар уже зарезервовано або замовлено. Оновіть закупівлю.'
            )
        }

        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'CONFIRMED', version: { increment: 1 } },
        })
        return { id: order.id, version: order.version + 1, status: 'CONFIRMED' }
      })
    },
    async cancelRemainder(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'purchase.cancel', input, async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
          where: { ...org, id: input.documentId, version: input.expectedVersion },
          include: { purchaseOrderLine_order: true },
        })
        if (!order || !['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status))
          throw new Error('Замовлення не можна скасувати')
        for (const line of order.purchaseOrderLine_order) {
          const received = await receivedQty(tx, ctx, line.id)
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { qtyCancelled: line.qtyOrdered.minus(received) },
          })
        }
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        })
        return { id: order.id, version: order.version + 1, status: 'CANCELLED' }
      })
    },
    async allocateReceipt(raw: unknown) {
      const input = receiptAllocationSchema.parse(raw)
      return ledgerCommand(db, ctx, 'receipt.allocate', input, async (tx) => {
        const doc = await tx.inventoryDocument.findFirst({
          where: { ...org, id: input.documentId, status: 'DRAFT', version: input.expectedVersion },
          include: { inventoryDocumentLine_document: true },
        })
        if (!doc) throw new Error('Чернетка не знайдена або змінена')
        await tx.receiptDemandAllocation.deleteMany({
          where: { ...org, receiptLine: { documentId: doc.id } },
        })
        for (const allocation of input.allocations) {
          const line = doc.inventoryDocumentLine_document.find(
            (l) => l.id === allocation.receiptLineId
          )
          const demand = await tx.stockDemand.findFirst({
            where: { ...org, id: allocation.demandId, state: 'ACTIVE', ownership: 'OWN' },
          })
          if (!line || !demand || line.inventoryPartId !== demand.inventoryPartId)
            throw new Error('Потреба не відповідає товару приходу')
          if (
            input.allocations
              .filter((a) => a.receiptLineId === line.id)
              .reduce((s, a) => s.plus(a.quantity), D(0))
              .gt(line.quantity)
          )
            throw new Error('Розподіл перевищує кількість приходу')
          if (!allocation.purchaseAllocationId && line.purchaseOrderLineId) {
            const candidates = await tx.purchaseDemandAllocation.findMany({
              where: {
                ...org,
                demandId: demand.id,
                purchaseOrderLineId: line.purchaseOrderLineId,
              },
            })
            const pending = candidates.filter((a) => a.fulfilledQty.lt(a.quantity))
            if (pending.length === 1) allocation.purchaseAllocationId = pending[0].id
            else if (pending.length > 1)
              throw new Error('Неоднозначний розподіл закупівлі: виберіть джерело')
          }
          if (allocation.purchaseAllocationId) {
            const pa = await tx.purchaseDemandAllocation.findFirst({
              where: {
                ...org,
                id: allocation.purchaseAllocationId,
                demandId: demand.id,
                purchaseOrderLineId: line.purchaseOrderLineId ?? '',
              },
            })
            if (!pa) throw new Error('Розподіл закупівлі не знайдений')
          }
          await tx.receiptDemandAllocation.create({ data: { ...meta, ...allocation } })
        }
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { version: { increment: 1 } },
        })
        return { id: doc.id, version: doc.version + 1 }
      })
    },
  }
}
export async function receivedQty(tx: Tx, ctx: LedgerContext, purchaseOrderLineId: string) {
  const received = await tx.inventoryDocumentLine.aggregate({
    where: {
      organizationId: ctx.organizationId,
      purchaseOrderLineId,
      document: { status: 'POSTED', kind: 'RECEIPT' },
    },
    _sum: { quantity: true },
  })
  return received._sum.quantity ?? D(0)
}
export async function postReceiptProcurement(tx: Tx, ctx: LedgerContext, documentId: string) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  const doc = await tx.inventoryDocument.findFirstOrThrow({
    where: { ...org, id: documentId },
    include: {
      inventoryDocumentLine_document: { include: { receiptDemandAllocation_receiptLine: true } },
    },
  })
  const orders = new Set<string>()
  for (const line of doc.inventoryDocumentLine_document) {
    if (line.purchaseOrderLineId) {
      const po = await tx.purchaseOrderLine.findFirst({
        where: { ...org, id: line.purchaseOrderLineId },
        include: { order: true },
      })
      if (
        !po ||
        po.inventoryPartId !== line.inventoryPartId ||
        po.order.supplierId !== doc.supplierId ||
        !['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(po.order.status)
      )
        throw new Error('Рядок закупівлі не відповідає приходу')
      const incoming = doc.inventoryDocumentLine_document
        .filter((l) => l.purchaseOrderLineId === po.id)
        .reduce((s, l) => s.plus(l.quantity), D(0))
      if (
        (await receivedQty(tx, ctx, po.id)).plus(incoming).gt(po.qtyOrdered.minus(po.qtyCancelled))
      )
        throw new Error('Прихід перевищує залишок замовлення постачальнику')
      orders.add(po.orderId)
    }
    const allocations = line.receiptDemandAllocation_receiptLine
    if (allocations.reduce((s, a) => s.plus(a.quantity), D(0)).gt(line.quantity))
      throw new Error('Розподіл перевищує кількість приходу')
    if (allocations.length === 0) continue
    const lot = await tx.stockLot.findUniqueOrThrow({
      where: { organizationId_sourceLineId: { ...org, sourceLineId: line.id } },
    })
    for (const allocation of allocations) {
      const demand = await tx.stockDemand.findFirstOrThrow({
        where: {
          ...org,
          id: allocation.demandId,
          state: 'ACTIVE',
          ownership: 'OWN',
          inventoryPartId: line.inventoryPartId,
        },
      })
      const issued = await tx.documentLotAllocation.findMany({
        where: { ...org, demandId: demand.id },
        include: { documentLine: { include: { document: true } } },
      })
      const net = issued.reduce(
        (s, a) => s.plus(a.quantity.mul(a.documentLine.document.kind === 'ISSUE' ? 1 : -1)),
        D(0)
      )
      const reserved = await tx.stockReservation.aggregate({
        where: { ...org, demandId: demand.id },
        _sum: { remainingQuantity: true },
      })
      if (
        D(allocation.quantity).gt(
          demand.requiredQty.minus(net).minus(reserved._sum.remainingQuantity ?? 0)
        )
      )
        throw new Error('Розподіл перевищує незабезпечену потребу')
      const warehouse = await tx.warehouse.findFirstOrThrow({
        where: { ...org, id: doc.targetWarehouseId!, reservable: true },
      })
      const r = await tx.stockReservation.create({
        data: {
          ...meta,
          demandId: demand.id,
          lotId: lot.id,
          warehouseId: warehouse.id,
          createdQuantity: allocation.quantity,
          remainingQuantity: allocation.quantity,
        },
      })
      await tx.stockLotBalance.update({
        where: {
          organizationId_lotId_warehouseId: { ...org, lotId: lot.id, warehouseId: warehouse.id },
        },
        data: { reservedQty: { increment: allocation.quantity }, version: { increment: 1 } },
      })
      await tx.reservationEvent.create({
        data: {
          ...meta,
          reservationId: r.id,
          kind: 'RESERVE',
          quantity: allocation.quantity,
          effectiveAt: doc.effectiveAt,
          operationKey: 'receipt-allocation:' + allocation.id,
        },
      })
      if (allocation.purchaseAllocationId) {
        const pa = await tx.purchaseDemandAllocation.findFirstOrThrow({
          where: {
            ...org,
            id: allocation.purchaseAllocationId,
            demandId: demand.id,
            purchaseOrderLineId: line.purchaseOrderLineId!,
          },
        })
        if (pa.fulfilledQty.plus(allocation.quantity).gt(pa.quantity))
          throw new Error('Отримано більше за розподіл закупівлі')
        await tx.purchaseDemandAllocation.update({
          where: { id: pa.id },
          data: { fulfilledQty: { increment: allocation.quantity } },
        })
      }
    }
  }
  return orders
}
export async function refreshPurchaseOrders(tx: Tx, ctx: LedgerContext, ids: Set<string>) {
  for (const id of ids) {
    const lines = await tx.purchaseOrderLine.findMany({
      where: { organizationId: ctx.organizationId, orderId: id },
    })
    let complete = true,
      anyReceived = false
    for (const line of lines) {
      const received = await receivedQty(tx, ctx, line.id)
      if (received.gt(0)) anyReceived = true
      if (received.lt(line.qtyOrdered.minus(line.qtyCancelled))) complete = false
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: complete ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'CONFIRMED',
        version: { increment: 1 },
      },
    })
  }
}

/** Draft-only proposal. Existing draft allocations are counted so two partial
 * deliveries cannot promise the same demand. Posting revalidates every limit. */
export async function autoAllocatePurchaseReceipt(tx: Tx, ctx: LedgerContext, documentId: string) {
  const org = { organizationId: ctx.organizationId }
  const doc = await tx.inventoryDocument.findFirstOrThrow({
    where: { ...org, id: documentId, status: 'DRAFT' },
    include: { inventoryDocumentLine_document: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  })
  for (const line of doc.inventoryDocumentLine_document) {
    if (!line.purchaseOrderLineId) continue
    const po = await tx.purchaseOrderLine.findFirstOrThrow({
      where: { ...org, id: line.purchaseOrderLineId },
      include: {
        order: true,
        purchaseDemandAllocation_purchaseOrderLine: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    })
    if (
      po.order.supplierId !== doc.supplierId ||
      po.order.warehouseId !== doc.targetWarehouseId ||
      po.inventoryPartId !== line.inventoryPartId ||
      !['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(po.order.status)
    )
      throw new Error('Закупівля не відповідає приходу або вже закрита')
    const drafts = await tx.inventoryDocumentLine.aggregate({
      where: { ...org, purchaseOrderLineId: po.id, document: { status: 'DRAFT', kind: 'RECEIPT' } },
      _sum: { quantity: true },
    })
    if (
      (drafts._sum.quantity ?? D(0))
        .plus(await receivedQty(tx, ctx, po.id))
        .gt(po.qtyOrdered.minus(po.qtyCancelled))
    )
      throw new Error(
        'Кількість уже включена в іншу чернетку приходу або перевищує залишок закупівлі'
      )
    let available = D(line.quantity)
    for (const allocation of po.purchaseDemandAllocation_purchaseOrderLine) {
      if (available.isZero()) break
      const demand = await tx.stockDemand.findFirst({
        where: { ...org, id: allocation.demandId, state: 'ACTIVE', ownership: 'OWN' },
        include: {
          stockReservation_demand: true,
          documentLotAllocation_demand: {
            include: { documentLine: { include: { document: true } } },
          },
        },
      })
      if (!demand) continue
      const draftAllocations = await tx.receiptDemandAllocation.findMany({
        where: {
          ...org,
          receiptLine: { document: { status: 'DRAFT' } },
          OR: [{ demandId: demand.id }, { purchaseAllocationId: allocation.id }],
        },
      })
      const pending = D(allocation.quantity)
        .minus(allocation.fulfilledQty)
        .minus(
          draftAllocations
            .filter((a) => a.purchaseAllocationId === allocation.id)
            .reduce((sum, a) => sum.plus(a.quantity), D(0))
        )
      const issued = demand.documentLotAllocation_demand.reduce(
        (sum, a) => sum.plus(a.quantity.mul(a.documentLine.document.kind === 'ISSUE' ? 1 : -1)),
        D(0)
      )
      const need = D(demand.requiredQty)
        .minus(issued)
        .minus(
          demand.stockReservation_demand.reduce((sum, r) => sum.plus(r.remainingQuantity), D(0))
        )
        .minus(
          draftAllocations
            .filter((a) => a.demandId === demand.id)
            .reduce((sum, a) => sum.plus(a.quantity), D(0))
        )
      const quantity = [available, pending, need].reduce((a, b) => (a.lt(b) ? a : b))
      if (quantity.lte(0)) continue
      await tx.receiptDemandAllocation.create({
        data: {
          ...metadata(ctx),
          receiptLineId: line.id,
          demandId: demand.id,
          purchaseAllocationId: allocation.id,
          quantity,
        },
      })
      available = available.minus(quantity)
    }
  }
}
