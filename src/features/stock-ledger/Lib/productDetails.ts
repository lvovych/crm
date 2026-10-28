import { z } from 'zod'
import type { Tx, LedgerContext } from './transaction'
export async function productDetails(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({
      productId: z.string().min(1),
      page: z.number().int().min(1).max(100000).default(1),
      tab: z.enum(['balances', 'lots', 'reservations']),
    })
    .parse(raw)
  const product = await tx.inventoryPart.findFirst({
    where: { id: input.productId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!product) throw new Error('Товар не знайдено')
  const where = { organizationId: ctx.organizationId, lot: { inventoryPartId: product.id } }
  const pagination = { skip: (input.page - 1) * 25, take: 25 }
  if (input.tab === 'balances') {
    const grouped = await tx.stockLotBalance.groupBy({
      by: ['warehouseId'],
      where,
      _sum: { onHandQty: true, reservedQty: true },
      orderBy: { warehouseId: 'asc' },
    })
    const slice = grouped.slice(pagination.skip, pagination.skip + pagination.take)
    const warehouses = await tx.warehouse.findMany({
      where: { organizationId: ctx.organizationId, id: { in: slice.map((r) => r.warehouseId) } },
      select: { id: true, name: true },
    })
    return {
      total: grouped.length,
      rows: slice.map((r) => ({
        id: r.warehouseId,
        label: warehouses.find((w) => w.id === r.warehouseId)?.name ?? '',
        detail: 'Разом на складі',
        quantity: r._sum.onHandQty?.toFixed(3) ?? '0.000',
        reserved: r._sum.reservedQty?.toFixed(3) ?? '0.000',
        recordId: null as string | null,
        vehicleId: null as string | null,
      })),
    }
  }
  if (input.tab === 'reservations') {
    const filter = { ...where, remainingQuantity: { gt: 0 } }
    const [rows, total] = await Promise.all([
      tx.stockReservation.findMany({
        where: filter,
        ...pagination,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          warehouse: { select: { name: true } },
          demand: {
            select: { serviceRecord: { select: { id: true, title: true, vehicleId: true } } },
          },
        },
      }),
      tx.stockReservation.count({ where: filter }),
    ])
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        label: r.warehouse.name,
        detail: r.demand.serviceRecord.title,
        quantity: r.remainingQuantity.toFixed(3),
        reserved: null as string | null,
        recordId: r.demand.serviceRecord.id,
        vehicleId: r.demand.serviceRecord.vehicleId,
      })),
    }
  }
  const [rows, total] = await Promise.all([
    tx.stockLotBalance.findMany({
      where,
      ...pagination,
      orderBy: [{ warehouseId: 'asc' }, { lotId: 'asc' }],
      include: {
        warehouse: { select: { name: true } },
        lot: {
          select: {
            acquiredAt: true,
            sourceLine: { select: { document: { select: { number: true } } } },
          },
        },
      },
    }),
    tx.stockLotBalance.count({ where }),
  ])
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      label: r.warehouse.name,
      detail: `${r.lot.sourceLine.document.number} · ${r.lot.acquiredAt.toISOString().slice(0, 10)}`,
      quantity: r.onHandQty.toFixed(3),
      reserved: r.reservedQty.toFixed(3),
      recordId: null as string | null,
      vehicleId: null as string | null,
    })),
  }
}
